// Data access + business rules that touch the database. Pure logic lives in /public/shared.
import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_SRS, normalizeSrs, replay, REVIEW_OUTCOMES, OUTCOMES } from '../public/shared/srs.js';
import { DEFAULT_PRIORITY, normalizePriority } from '../public/shared/priority.js';
import { DEFAULT_PLANNER, normalizePlanner } from '../public/shared/planner.js';
import { todayStr, isDate, addDays } from '../public/shared/dates.js';
import { validate, ValidationError, MISTAKE_SPEC, TEST_SPEC, TASK_SPEC, LOG_SPEC, cleanBreakdown } from './validate.js';

export const DEFAULT_SETTINGS = {
  srs: DEFAULT_SRS,
  priority: DEFAULT_PRIORITY,
  planner: DEFAULT_PLANNER,
  general: { examDate: '', dailyTargetMin: 0, slowSeconds: 180, defaultBudgetMin: 90 },
  savedFilters: [],
};
const NORMALIZERS = { srs: normalizeSrs, priority: normalizePriority, planner: normalizePlanner };

const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
const bad = (field, msg) => new ValidationError({ [field]: msg });
const now = () => new Date().toISOString();

const parseMistake = (r) => ({
  ...r,
  causes_secondary: JSON.parse(r.causes_secondary || '[]'),
  tags: JSON.parse(r.tags || '[]'),
  guessed: !!r.guessed,
  skipped_solvable: !!r.skipped_solvable,
  archived: !!r.archived,
});
const parseTest = (r) => ({ ...r, breakdown: JSON.parse(r.breakdown || '[]') });

export function createStore(db) {
  // Queries inside tx() are routed to the transaction's connection via AsyncLocalStorage.
  const als = new AsyncLocalStorage();
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const exec = (sql, params) => (als.getStore() ?? db).query(toPg(sql), params);
  const q = async (sql, ...p) => (await exec(sql, p)).rows;
  const one = async (sql, ...p) => (await exec(sql, p)).rows[0];
  const run = async (sql, ...p) => ({ changes: (await exec(sql, p)).rowCount });
  /** INSERT … RETURNING id */
  const ins = async (sql, ...p) => Number((await exec(sql + ' RETURNING id', p)).rows[0].id);
  const exists = async (sql, ...p) => !!(await one(sql, ...p));

  async function tx(fn) {
    if (als.getStore()) return fn(); // already inside a transaction; the outermost one commits/rolls back
    const c = await db.connect();
    try {
      await c.exec('BEGIN');
      const r = await als.run(c, fn);
      await c.exec('COMMIT');
      return r;
    } catch (e) {
      await c.exec('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /* ---------- streams (papers) ---------- */
  const needStream = async (streamId) => {
    if (!(await exists('SELECT 1 x FROM streams WHERE id=?', Number(streamId) || 0))) throw bad('stream', 'choose what you are studying first');
    return Number(streamId);
  };
  const listStreams = () =>
    q(`SELECT s.id, s.code, s.name,
         (SELECT COUNT(*)::int FROM subjects x WHERE x.stream_id = s.id) AS subjects,
         (SELECT COUNT(*)::int FROM mistakes m JOIN subjects x ON x.id = m.subject_id WHERE x.stream_id = s.id AND m.archived = 0) AS mistakes
       FROM streams s ORDER BY s.sort, s.id`);
  async function createStream(input) {
    const v = validate({ name: { t: 'str', req: true, len: 100 }, code: { t: 'str', req: true, len: 12 } }, input);
    const code = v.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw bad('code', 'use letters, numbers, - or _ only (e.g. ME, DA, CE)');
    try {
      const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM streams')).n;
      const id = await ins('INSERT INTO streams (code, name, sort) VALUES (?,?,?)', code, v.name.trim(), sort);
      return one('SELECT * FROM streams WHERE id=?', id);
    } catch (e) {
      if (e.code === '23505') throw bad('code', 'a stream with this code already exists');
      throw e;
    }
  }
  async function updateStream(id, input) {
    const v = validate({ name: { t: 'str', req: true, len: 100 } }, input);
    if (!(await run('UPDATE streams SET name=? WHERE id=?', v.name.trim(), id)).changes) throw notFound('Stream');
    return one('SELECT * FROM streams WHERE id=?', id);
  }
  async function deleteStream(id) {
    if ((await one('SELECT COUNT(*)::int AS n FROM streams')).n <= 1) throw bad('stream', 'you need at least one stream');
    if (await exists('SELECT 1 x FROM mistakes m JOIN subjects s ON s.id = m.subject_id WHERE s.stream_id=?', id)) throw bad('stream', 'has recorded mistakes; delete them first');
    if (!(await run('DELETE FROM streams WHERE id=?', id)).changes) throw notFound('Stream');
    return { ok: true };
  }

  /* ---------- settings ---------- */
  async function getSettings() {
    const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    for (const r of await q('SELECT key, value FROM settings')) {
      try {
        const v = JSON.parse(r.value);
        out[r.key] = Array.isArray(v) || typeof v !== 'object' || v === null ? v : { ...out[r.key], ...v };
      } catch {
        /* ignore corrupt entry, keep default */
      }
    }
    out.srs = normalizeSrs(out.srs);
    return out;
  }
  async function putSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) throw bad('key', 'unknown setting');
    if (NORMALIZERS[key]) {
      if (key === 'srs') {
        const iv = value?.intervals;
        if (!Array.isArray(iv) || !iv.length || iv.some((n) => !(Number(n) >= 1))) throw bad('intervals', 'need at least one interval of ≥ 1 day');
      }
      value = NORMALIZERS[key](value);
    }
    if (key === 'general') {
      if (value.examDate && !isDate(value.examDate)) throw bad('examDate', 'must be a date');
      value = { ...DEFAULT_SETTINGS.general, ...value };
    }
    if (key === 'savedFilters' && !Array.isArray(value)) throw bad('savedFilters', 'must be a list');
    await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
    if (key === 'srs') await recomputeAll();
    return getSettings();
  }

  /* ---------- schedule state ---------- */
  async function recompute(id, srsCfg) {
    const m = await one('SELECT id, date_encountered, next_review_override FROM mistakes WHERE id = ?', id);
    if (!m) return;
    const events = await q('SELECT id, date, outcome FROM reviews WHERE mistake_id = ?', id);
    const s = replay(m.date_encountered, events, srsCfg ?? (await getSettings()).srs);
    if (m.next_review_override) s.next_review = m.next_review_override;
    await run(
      `UPDATE mistakes SET status=?, stage=?, streak=?, fail_count=?, recurrence_count=?, reopen_count=?, review_count=?, success_count=?,
       last_review=?, last_success=?, mastered_at=?, next_review=?, updated_at=? WHERE id=?`,
      s.status, s.stage, s.streak, s.fail_count, s.recurrence_count, s.reopen_count, s.review_count, s.success_count,
      s.last_review, s.last_success, s.mastered_at, s.next_review, now(), id,
    );
  }
  async function recomputeAll() {
    await tx(async () => {
      const srs = (await getSettings()).srs;
      for (const r of await q('SELECT id FROM mistakes')) await recompute(r.id, srs);
    });
  }

  /* ---------- reference checks ---------- */
  async function checkRefs(v) {
    if (v.subject_id != null && !(await exists('SELECT 1 x FROM subjects WHERE id=?', v.subject_id))) throw bad('subject_id', 'unknown subject');
    if (v.topic_id != null) {
      const t = await one('SELECT subject_id, parent_id FROM topics WHERE id=?', v.topic_id);
      if (!t) throw bad('topic_id', 'unknown topic');
      if (v.subject_id != null && t.subject_id !== v.subject_id) throw bad('topic_id', 'topic does not belong to the subject');
    }
    if (v.subtopic_id != null) {
      const t = await one('SELECT parent_id FROM topics WHERE id=?', v.subtopic_id);
      if (!t) throw bad('subtopic_id', 'unknown subtopic');
      if (v.topic_id != null && t.parent_id !== v.topic_id) throw bad('subtopic_id', 'subtopic does not belong to the topic');
    }
    if (v.cause_primary != null && !(await exists('SELECT 1 x FROM causes WHERE id=?', v.cause_primary))) throw bad('cause_primary', 'unknown cause');
    if (v.test_id != null && !(await exists('SELECT 1 x FROM tests WHERE id=?', v.test_id))) throw bad('test_id', 'unknown test');
  }

  /* ---------- mistakes ---------- */
  const MCOLS = Object.keys(MISTAKE_SPEC);
  const toRow = (v) => {
    const r = { ...v };
    if (r.causes_secondary) r.causes_secondary = JSON.stringify(r.causes_secondary);
    if (r.tags) r.tags = JSON.stringify(r.tags);
    return r;
  };

  async function createMistake(input, today = todayStr()) {
    const v = validate(MISTAKE_SPEC, input);
    v.date_encountered ||= today;
    v.causes_secondary = (v.causes_secondary || []).filter((c) => c !== v.cause_primary);
    v.tags ||= [];
    await checkRefs(v);
    if (v.test_id) await fillFromTest(v);
    const cols = MCOLS.filter((c) => v[c] !== undefined);
    const row = toRow(v);
    const ts = now();
    const id = await tx(async () => {
      const nid = await ins(
        `INSERT INTO mistakes (${cols.join(',')}, next_review, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?, ?)`,
        ...cols.map((c) => row[c]), v.date_encountered, ts, ts,
      );
      await recompute(nid);
      return nid;
    });
    return getMistake(id);
  }

  async function fillFromTest(v) {
    const t = await one('SELECT * FROM tests WHERE id=?', v.test_id);
    v.test_name ??= t.name;
    v.provider ??= t.provider;
    v.test_type ??= t.type;
  }

  async function updateMistake(id, input) {
    const cur = await one('SELECT subject_id, topic_id, cause_primary FROM mistakes WHERE id=?', id);
    if (!cur) throw notFound('Mistake');
    const v = validate(MISTAKE_SPEC, input, { partial: true });
    await checkRefs({ ...v, subject_id: v.subject_id ?? cur.subject_id, topic_id: v.topic_id === undefined ? (v.subject_id ? null : cur.topic_id) : v.topic_id });
    if (v.causes_secondary) v.causes_secondary = v.causes_secondary.filter((c) => c !== (v.cause_primary ?? cur.cause_primary));
    const cols = MCOLS.filter((c) => v[c] !== undefined);
    if (cols.length) {
      const row = toRow(v);
      await tx(async () => {
        await run(`UPDATE mistakes SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=? WHERE id=?`, ...cols.map((c) => row[c]), now(), id);
        await recompute(id);
      });
    }
    return getMistake(id);
  }

  async function getMistake(id) {
    const r = await one('SELECT * FROM mistakes WHERE id=?', id);
    if (!r) throw notFound('Mistake');
    return parseMistake(r);
  }

  async function deleteMistake(id) {
    if (!(await run('DELETE FROM mistakes WHERE id=?', id)).changes) throw notFound('Mistake');
    return { ok: true };
  }

  async function duplicateMistake(id, date) {
    const m = await getMistake(id);
    const copy = {};
    for (const c of MCOLS) if (m[c] !== undefined && c !== 'archived' && c !== 'next_review_override') copy[c] = m[c];
    copy.date_encountered = isDate(date) ? date : todayStr();
    return createMistake(copy);
  }

  async function bulk({ ids, action, value }) {
    if (!Array.isArray(ids) || !ids.length) throw bad('ids', 'select at least one mistake');
    ids = ids.map(Number);
    const patch = {
      archive: { archived: 1 },
      unarchive: { archived: 0 },
      set_cause: { cause_primary: value },
      set_severity: { severity: value },
      set_subject: { subject_id: value, topic_id: null, subtopic_id: null },
      set_next_review: { next_review_override: value },
    }[action];
    if (action === 'delete') {
      await tx(async () => {
        for (const id of ids) await run('DELETE FROM mistakes WHERE id=?', id);
      });
      return { ok: true, count: ids.length };
    }
    if (action === 'add_tag') {
      const tag = String(value || '').trim();
      if (!tag) throw bad('value', 'tag required');
      await tx(async () => {
        for (const id of ids) {
          const m = await getMistake(id);
          if (!m.tags.includes(tag)) await updateMistake(id, { tags: [...m.tags, tag] });
        }
      });
      return { ok: true, count: ids.length };
    }
    if (!patch) throw bad('action', 'unknown bulk action');
    await tx(async () => {
      for (const id of ids) await updateMistake(id, patch);
    });
    return { ok: true, count: ids.length };
  }

  /* ---------- reviews ---------- */
  async function addReview(mistakeId, { outcome, date, note, time_spent_sec }) {
    const m = await one('SELECT date_encountered FROM mistakes WHERE id=?', mistakeId);
    if (!m) throw notFound('Mistake');
    if (!REVIEW_OUTCOMES.includes(outcome) && outcome !== 'recurred') throw bad('outcome', `must be one of ${[...REVIEW_OUTCOMES, 'recurred'].join(', ')}`);
    date = date || todayStr();
    if (!isDate(date)) throw bad('date', 'must be a date YYYY-MM-DD');
    if (date < m.date_encountered) throw bad('date', 'review cannot be before the date the mistake was encountered');
    await tx(async () => {
      await run('INSERT INTO reviews (mistake_id, date, outcome, note, time_spent_sec, created_at) VALUES (?,?,?,?,?,?)', mistakeId, date, outcome, note || null, time_spent_sec || null, now());
      await run('UPDATE mistakes SET next_review_override = NULL WHERE id = ?', mistakeId); // a real review supersedes a manual date
      await recompute(mistakeId);
    });
    return getMistake(mistakeId);
  }
  async function updateReview(id, { date, outcome, note }) {
    const r = await one('SELECT * FROM reviews WHERE id=?', id);
    if (!r) throw notFound('Review');
    if (date !== undefined && !isDate(date)) throw bad('date', 'must be a date');
    if (outcome !== undefined && !OUTCOMES[outcome]) throw bad('outcome', 'invalid');
    await tx(async () => {
      await run('UPDATE reviews SET date=?, outcome=?, note=? WHERE id=?', date ?? r.date, outcome ?? r.outcome, note === undefined ? r.note : note, id);
      await recompute(r.mistake_id);
    });
    return getMistake(r.mistake_id);
  }
  async function deleteReview(id) {
    const r = await one('SELECT mistake_id FROM reviews WHERE id=?', id);
    if (!r) throw notFound('Review');
    await tx(async () => {
      await run('DELETE FROM reviews WHERE id=?', id);
      await recompute(r.mistake_id);
    });
    return getMistake(r.mistake_id);
  }

  /* ---------- tests ---------- */
  async function saveTest(id, input, streamId) {
    const v = validate(TEST_SPEC, input, { partial: !!id });
    if (!id) v.stream_id = await needStream(streamId);
    if (v.breakdown !== undefined) {
      v.breakdown = cleanBreakdown(v.breakdown);
      for (const b of v.breakdown) {
        if (!(await exists('SELECT 1 x FROM subjects WHERE id=?', b.subject_id))) throw bad('breakdown', 'unknown subject');
        if (b.topic_id && !(await exists('SELECT 1 x FROM topics WHERE id=?', b.topic_id))) throw bad('breakdown', 'unknown topic');
      }
      v.breakdown = JSON.stringify(v.breakdown);
    }
    const c = (v.correct ?? 0) + (v.incorrect ?? 0);
    if (v.total_questions != null && c > v.total_questions) throw bad('correct', 'correct + incorrect exceeds total questions');
    if (v.marks_obtained != null && v.total_marks != null && v.marks_obtained > v.total_marks) throw bad('marks_obtained', 'exceeds total marks');
    const cols = Object.keys(v);
    const ts = now();
    if (id) {
      if (!(await exists('SELECT 1 x FROM tests WHERE id=?', id))) throw notFound('Test');
      if (cols.length) await run(`UPDATE tests SET ${cols.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...cols.map((k) => v[k]), ts, id);
    } else {
      id = await ins(`INSERT INTO tests (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`, ...cols.map((k) => v[k]), ts, ts);
    }
    return parseTest(await one('SELECT * FROM tests WHERE id=?', id));
  }
  async function deleteTest(id) {
    if (!(await run('DELETE FROM tests WHERE id=?', id)).changes) throw notFound('Test'); // linked mistakes keep their text fields (test_id -> NULL)
    return { ok: true };
  }

  /* ---------- schedule / tracker ---------- */
  async function saveTask(id, input, repeatWeeks = 0, streamId) {
    const v = validate(TASK_SPEC, input, { partial: !!id });
    if (!id) v.stream_id = await needStream(streamId);
    if (v.subject_id != null && !(await exists('SELECT 1 x FROM subjects WHERE id=?', v.subject_id))) throw bad('subject_id', 'unknown subject');
    if (v.topic_id != null && !(await exists('SELECT 1 x FROM topics WHERE id=?', v.topic_id))) throw bad('topic_id', 'unknown topic');
    const ts = now();
    if (id) {
      if (!(await exists('SELECT 1 x FROM tasks WHERE id=?', id))) throw notFound('Task');
      if ('done' in v) v.done_at = v.done ? ts : null;
      const cols = Object.keys(v);
      if (cols.length) await run(`UPDATE tasks SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...cols.map((k) => v[k]), id);
      return one('SELECT * FROM tasks WHERE id=?', id);
    }
    const n = Math.min(Math.max(Number(repeatWeeks) || 0, 0), 30);
    const ids = [];
    await tx(async () => {
      for (let i = 0; i <= n; i++) {
        const row = { ...v, date: addDays(v.date, 7 * i) };
        const cols = Object.keys(row);
        ids.push(await ins(`INSERT INTO tasks (${cols.join(',')}, created_at) VALUES (${cols.map(() => '?').join(',')}, ?)`, ...cols.map((k) => row[k]), ts));
      }
    });
    return one('SELECT * FROM tasks WHERE id=?', ids[0]);
  }
  async function deleteTask(id) {
    if (!(await run('DELETE FROM tasks WHERE id=?', id)).changes) throw notFound('Task');
    return { ok: true };
  }
  async function addLog(input, streamId) {
    const v = validate(LOG_SPEC, input);
    v.stream_id = await needStream(streamId);
    if (v.subject_id != null && !(await exists('SELECT 1 x FROM subjects WHERE id=?', v.subject_id))) throw bad('subject_id', 'unknown subject');
    const cols = Object.keys(v);
    const id = await ins(`INSERT INTO study_log (${cols.join(',')}, created_at) VALUES (${cols.map(() => '?').join(',')}, ?)`, ...cols.map((k) => v[k]), now());
    return one('SELECT * FROM study_log WHERE id=?', id);
  }
  async function deleteLog(id) {
    if (!(await run('DELETE FROM study_log WHERE id=?', id)).changes) throw notFound('Log entry');
    return { ok: true };
  }
  async function putProgress(topicId, input) {
    if (!(await exists('SELECT 1 x FROM topics WHERE id=?', topicId))) throw notFound('Topic');
    const cur = (await one('SELECT * FROM topic_progress WHERE topic_id=?', topicId)) || { studied: 0, revision_count: 0, pyq_done: 0, notes: null };
    const v = validate({ studied: { t: 'bool' }, revision_count: { t: 'int', min: 0, max: 99 }, pyq_done: { t: 'bool' }, notes: { t: 'str', len: 2000 } }, input, { partial: true });
    const n = { ...cur, ...v };
    await run(
      `INSERT INTO topic_progress (topic_id, studied, revision_count, pyq_done, notes, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT (topic_id) DO UPDATE SET studied=excluded.studied, revision_count=excluded.revision_count, pyq_done=excluded.pyq_done, notes=excluded.notes, updated_at=excluded.updated_at`,
      topicId, n.studied ? 1 : 0, n.revision_count || 0, n.pyq_done ? 1 : 0, n.notes ?? null, now(),
    );
    return one('SELECT * FROM topic_progress WHERE topic_id=?', topicId);
  }

  /* ---------- syllabus + causes configuration ---------- */
  async function saveSubject(id, input, streamId) {
    const v = validate({ name: { t: 'str', req: true, len: 200 }, section: { t: 'str', len: 200 }, importance: { t: 'int', min: 1, max: 5 } }, input, { partial: !!id });
    try {
      if (id) {
        if (!(await exists('SELECT 1 x FROM subjects WHERE id=?', id))) throw notFound('Subject');
        const cols = Object.keys(v);
        if (cols.length) await run(`UPDATE subjects SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...cols.map((k) => v[k]), id);
      } else {
        const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM subjects WHERE stream_id=?', Number(streamId) || 0)).n;
        id = await ins('INSERT INTO subjects (stream_id, section, name, importance, sort) VALUES (?,?,?,?,?)', await needStream(streamId), v.section ?? null, v.name, v.importance ?? 3, sort);
      }
    } catch (e) {
      if (e.code === '23505') throw bad('name', 'a subject with this name already exists');
      throw e;
    }
    return one('SELECT * FROM subjects WHERE id=?', id);
  }
  async function deleteSubject(id) {
    if (await exists('SELECT 1 x FROM mistakes WHERE subject_id=?', id)) throw bad('subject', 'has recorded mistakes; reassign or delete them first');
    if (!(await run('DELETE FROM subjects WHERE id=?', id)).changes) throw notFound('Subject');
    return { ok: true };
  }
  async function saveTopic(id, input) {
    const v = validate({ subject_id: { t: 'int', req: true }, parent_id: { t: 'int' }, name: { t: 'str', req: true, len: 300 }, importance: { t: 'int', min: 1, max: 5 } }, input, { partial: !!id });
    if (v.parent_id) {
      const p = await one('SELECT subject_id, parent_id FROM topics WHERE id=?', v.parent_id);
      if (!p) throw bad('parent_id', 'unknown parent topic');
      if (p.parent_id) throw bad('parent_id', 'subtopics can only be one level deep');
      if (v.subject_id && p.subject_id !== v.subject_id) throw bad('parent_id', 'parent is in another subject');
    }
    if (id) {
      if (!(await exists('SELECT 1 x FROM topics WHERE id=?', id))) throw notFound('Topic');
      delete v.subject_id;
      delete v.parent_id; // moving topics is not supported; keeps references consistent
      const cols = Object.keys(v);
      if (cols.length) await run(`UPDATE topics SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...cols.map((k) => v[k]), id);
    } else {
      if (!(await exists('SELECT 1 x FROM subjects WHERE id=?', v.subject_id))) throw bad('subject_id', 'unknown subject');
      const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM topics WHERE subject_id=?', v.subject_id)).n;
      id = await ins('INSERT INTO topics (subject_id, parent_id, name, importance, sort) VALUES (?,?,?,?,?)', v.subject_id, v.parent_id ?? null, v.name, v.importance ?? 3, sort);
    }
    return one('SELECT * FROM topics WHERE id=?', id);
  }
  async function deleteTopic(id) {
    const used = (await one('SELECT COUNT(*)::int AS n FROM mistakes WHERE topic_id=? OR subtopic_id=?', id, id)).n;
    // mistakes keep existing (topic_id becomes NULL via ON DELETE SET NULL); the caller is told how many were detached
    if (!(await run('DELETE FROM topics WHERE id=?', id)).changes) throw notFound('Topic');
    return { ok: true, detached: used };
  }
  async function saveCause(id, input) {
    const v = validate({ name: { t: 'str', req: true, len: 200 }, description: { t: 'str', len: 1000 }, guidance: { t: 'str', len: 3000 } }, input, { partial: !!id });
    if (id) {
      if (!(await exists('SELECT 1 x FROM causes WHERE id=?', id))) throw notFound('Cause');
      const cols = Object.keys(v);
      if (cols.length) await run(`UPDATE causes SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...cols.map((k) => v[k]), id);
    } else {
      const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM causes')).n;
      id = await ins('INSERT INTO causes (name, description, guidance, sort) VALUES (?,?,?,?)', v.name, v.description ?? null, v.guidance ?? null, sort);
    }
    return one('SELECT * FROM causes WHERE id=?', id);
  }
  async function deleteCause(id) {
    if (await exists('SELECT 1 x FROM mistakes WHERE cause_primary=?', id)) throw bad('cause', 'is the primary cause of existing mistakes; reassign them first');
    if (!(await run('DELETE FROM causes WHERE id=?', id)).changes) throw notFound('Cause');
    return { ok: true };
  }

  /* ---------- screenshots (stored in the database so backups and every device see them) ---------- */
  async function saveAttachment(name, mime, buf) {
    await run('INSERT INTO attachments (name, mime, data, created_at) VALUES (?,?,?,?)', name, mime, buf, now());
    return { file: name };
  }
  async function getAttachment(name) {
    const r = await one('SELECT mime, data FROM attachments WHERE name=?', name);
    return r ? { mime: r.mime, data: Buffer.from(r.data) } : null;
  }

  /* ---------- everything the UI needs ---------- */
  async function bootstrap(streamId) {
    const [settings, causes, streams] = await Promise.all([getSettings(), q('SELECT * FROM causes ORDER BY sort, id'), listStreams()]);
    const stream = streams.find((x) => x.id === Number(streamId));
    if (!stream) return { today: todayStr(), needsStream: true, streams, settings, causes };
    const sid = stream.id;
    const inSubjects = 'SELECT id FROM subjects WHERE stream_id = ?';
    const [subjects, topics, mistakes, reviews, tests, tasks, studyLog, progress] = await Promise.all([
      q('SELECT * FROM subjects WHERE stream_id=? ORDER BY sort, id', sid),
      q(`SELECT * FROM topics WHERE subject_id IN (${inSubjects}) ORDER BY sort, id`, sid),
      q(`SELECT * FROM mistakes WHERE subject_id IN (${inSubjects}) ORDER BY id`, sid),
      q(`SELECT r.* FROM reviews r JOIN mistakes m ON m.id = r.mistake_id WHERE m.subject_id IN (${inSubjects}) ORDER BY r.date, r.id`, sid),
      q('SELECT * FROM tests WHERE stream_id=? ORDER BY date, id', sid),
      q('SELECT * FROM tasks WHERE stream_id=? ORDER BY date, id', sid),
      q('SELECT * FROM study_log WHERE stream_id=? ORDER BY date, id', sid),
      q(`SELECT p.* FROM topic_progress p JOIN topics t ON t.id = p.topic_id WHERE t.subject_id IN (${inSubjects})`, sid),
    ]);
    return { today: todayStr(), stream, streams, settings, subjects, topics, causes, mistakes: mistakes.map(parseMistake), reviews, tests: tests.map(parseTest), tasks, studyLog, progress };
  }

  return {
    bootstrap, listStreams, createStream, updateStream, deleteStream, getSettings, putSetting, recomputeAll,
    createMistake, updateMistake, getMistake, deleteMistake, duplicateMistake, bulk,
    addReview, updateReview, deleteReview,
    saveTest, deleteTest, saveTask, deleteTask, addLog, deleteLog, putProgress,
    saveSubject, deleteSubject, saveTopic, deleteTopic, saveCause, deleteCause,
    saveAttachment, getAttachment,
  };
}
