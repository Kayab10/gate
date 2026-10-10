// Data access + business rules that touch the database. Pure logic lives in /public/shared.
//
// Isolation rule: every function returned by forUser(uid) only ever touches rows with `user_id = uid`.
// IDs that arrive from a request are always looked up together with the user id, so another user's id
// behaves exactly like a missing one (404 / "unknown ...").
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_SRS, normalizeSrs, replay, REVIEW_OUTCOMES, OUTCOMES } from '../public/shared/srs.js';
import { DEFAULT_PRIORITY, normalizePriority } from '../public/shared/priority.js';
import { DEFAULT_PLANNER, normalizePlanner } from '../public/shared/planner.js';
import { todayStr, isDate, addDays } from '../public/shared/dates.js';
import { validate, ValidationError, MISTAKE_SPEC, TEST_SPEC, TASK_SPEC, LOG_SPEC, cleanBreakdown } from './validate.js';
import { BRANCHES, seedBranch, seedCauses } from './db.js';

const scrypt = promisify(crypto.scrypt);

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

const parseMistake = (r) => {
  const { user_id, ...m } = r; // never send the owner id to the browser
  return { ...m, causes_secondary: JSON.parse(m.causes_secondary || '[]'), tags: JSON.parse(m.tags || '[]'), guessed: !!m.guessed, skipped_solvable: !!m.skipped_solvable, archived: !!m.archived };
};
const parseTest = ({ user_id, ...t }) => ({ ...t, breakdown: JSON.parse(t.breakdown || '[]') });
const strip = (r) => {
  if (!r) return r;
  const { user_id, ...rest } = r;
  return rest;
};

/* ---------- passwords (scrypt, salted; nothing reversible is stored) ---------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function checkPassword(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return crypto.timingSafeEqual(got, want);
}
const DUMMY_HASH = hashPassword('not-a-real-password'); // so unknown emails take as long as wrong passwords

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

  /** Multi-row INSERT in chunks (one round trip per chunk instead of one per row). Returns the new ids in order if asked. */
  async function insertMany(table, cols, rows, { returning = false, suffix = '' } = {}) {
    const ids = [];
    const per = Math.max(1, Math.floor(30000 / cols.length));
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}${suffix}${returning ? ' RETURNING id' : ''}`;
      const r = await exec(sql, chunk.flatMap((row) => cols.map((c) => row[c] ?? null)));
      if (returning) ids.push(...r.rows.map((x) => Number(x.id)));
    }
    return ids;
  }

  /* ================= accounts (not scoped to a user) ================= */
  async function createUser({ email, name, password, branch }) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw bad('email', 'enter a valid email address');
    if (typeof password !== 'string' || password.length < 8) throw bad('password', 'use at least 8 characters');
    if (password.length > 200) throw bad('password', 'too long (max 200 characters)');
    if (!BRANCHES.some((b) => b.code === branch)) throw bad('branch', 'choose your branch');
    const pw = await hashPassword(password);
    try {
      return await tx(async () => {
        const uid = await ins('INSERT INTO users (email, name, pw_hash, created_at) VALUES (?,?,?,?)', email, String(name || '').trim().slice(0, 100) || null, pw, now());
        await seedCauses(exec, uid);
        await seedBranch(exec, uid, branch);
        return uid;
      });
    } catch (e) {
      if (e.code === '23505') throw bad('email', 'an account with this email already exists');
      throw e;
    }
  }
  async function verifyUser(email, password) {
    const u = await one('SELECT id, pw_hash FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
    const ok = await checkPassword(String(password ?? ''), u ? u.pw_hash : await DUMMY_HASH);
    return u && ok ? u.id : null;
  }
  const getUser = (uid) => one('SELECT id, email, name FROM users WHERE id = ?', uid);
  async function resetPassword(email, password) {
    if (typeof password !== 'string' || password.length < 8) throw bad('password', 'use at least 8 characters');
    return (await run('UPDATE users SET pw_hash = ? WHERE email = ?', await hashPassword(password), String(email).trim().toLowerCase())).changes > 0;
  }

  /* ================= everything below belongs to one user ================= */
  function forUser(uid) {
    /* ---------- branches (streams) ---------- */
    const needStream = async (streamId) => {
      if (!(await exists('SELECT 1 x FROM streams WHERE id=? AND user_id=?', Number(streamId) || 0, uid))) throw bad('stream', 'choose what you are studying first');
      return Number(streamId);
    };
    const listStreams = () =>
      q(`SELECT s.id, s.code, s.name,
           (SELECT COUNT(*)::int FROM subjects x WHERE x.stream_id = s.id) AS subjects,
           (SELECT COUNT(*)::int FROM mistakes m JOIN subjects x ON x.id = m.subject_id WHERE x.stream_id = s.id AND m.archived = 0) AS mistakes
         FROM streams s WHERE s.user_id = ? ORDER BY s.sort, s.id`, uid);
    async function availableBranches() {
      const have = new Set((await q('SELECT code FROM streams WHERE user_id = ?', uid)).map((r) => r.code));
      return BRANCHES.filter((b) => !have.has(b.code));
    }
    async function addBranch(code) {
      if (!(await availableBranches()).some((b) => b.code === code)) throw bad('code', 'you already have this branch (or it does not exist)');
      const id = await tx(() => seedBranch(exec, uid, code));
      return strip(await one('SELECT * FROM streams WHERE id=? AND user_id=?', id, uid));
    }

    /* ---------- settings ---------- */
    const buildSettings = (rows) => {
      const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      for (const r of rows) {
        try {
          const v = JSON.parse(r.value);
          out[r.key] = Array.isArray(v) || typeof v !== 'object' || v === null ? v : { ...out[r.key], ...v };
        } catch {
          /* ignore corrupt entry, keep default */
        }
      }
      out.srs = normalizeSrs(out.srs);
      return out;
    };
    async function getSettings() {
      return buildSettings(await q('SELECT key, value FROM settings WHERE user_id = ?', uid));
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
      await run('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value', uid, key, JSON.stringify(value));
      if (key === 'srs') await recomputeAll();
      return getSettings();
    }

    /* ---------- schedule state ---------- */
    async function recompute(id, srsCfg) {
      const m = await one('SELECT id, date_encountered, next_review_override FROM mistakes WHERE id = ? AND user_id = ?', id, uid);
      if (!m) return;
      const events = await q('SELECT id, date, outcome FROM reviews WHERE mistake_id = ? AND user_id = ?', id, uid);
      const s = replay(m.date_encountered, events, srsCfg ?? (await getSettings()).srs);
      if (m.next_review_override) s.next_review = m.next_review_override;
      await run(
        `UPDATE mistakes SET status=?, stage=?, streak=?, fail_count=?, recurrence_count=?, reopen_count=?, review_count=?, success_count=?,
         last_review=?, last_success=?, mastered_at=?, next_review=?, updated_at=? WHERE id=? AND user_id=?`,
        s.status, s.stage, s.streak, s.fail_count, s.recurrence_count, s.reopen_count, s.review_count, s.success_count,
        s.last_review, s.last_success, s.mastered_at, s.next_review, now(), id, uid,
      );
    }
    async function recomputeAll() {
      await tx(async () => {
        const srs = (await getSettings()).srs;
        for (const r of await q('SELECT id FROM mistakes WHERE user_id = ?', uid)) await recompute(r.id, srs);
      });
    }

    /* ---------- reference checks (every referenced row must be this user's) ---------- */
    async function checkRefs(v) {
      if (v.subject_id != null && !(await exists('SELECT 1 x FROM subjects WHERE id=? AND user_id=?', v.subject_id, uid))) throw bad('subject_id', 'unknown subject');
      if (v.topic_id != null) {
        const t = await one('SELECT subject_id, parent_id FROM topics WHERE id=? AND user_id=?', v.topic_id, uid);
        if (!t) throw bad('topic_id', 'unknown topic');
        if (v.subject_id != null && t.subject_id !== v.subject_id) throw bad('topic_id', 'topic does not belong to the subject');
      }
      if (v.subtopic_id != null) {
        const t = await one('SELECT parent_id FROM topics WHERE id=? AND user_id=?', v.subtopic_id, uid);
        if (!t) throw bad('subtopic_id', 'unknown subtopic');
        if (v.topic_id != null && t.parent_id !== v.topic_id) throw bad('subtopic_id', 'subtopic does not belong to the topic');
      }
      for (const c of [v.cause_primary, ...(v.causes_secondary || [])]) {
        if (c != null && !(await exists('SELECT 1 x FROM causes WHERE id=? AND user_id=?', c, uid))) throw bad('cause_primary', 'unknown cause');
      }
      if (v.test_id != null && !(await exists('SELECT 1 x FROM tests WHERE id=? AND user_id=?', v.test_id, uid))) throw bad('test_id', 'unknown test');
      if (v.attachment != null && !(await exists('SELECT 1 x FROM attachments WHERE name=? AND user_id=?', v.attachment, uid))) throw bad('attachment', 'unknown attachment');
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
          `INSERT INTO mistakes (user_id, ${cols.join(',')}, next_review, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(',')}, ?, ?, ?)`,
          uid, ...cols.map((c) => row[c]), v.date_encountered, ts, ts,
        );
        await recompute(nid);
        return nid;
      });
      return getMistake(id);
    }

    async function fillFromTest(v) {
      const t = await one('SELECT * FROM tests WHERE id=? AND user_id=?', v.test_id, uid);
      v.test_name ??= t.name;
      v.provider ??= t.provider;
      v.test_type ??= t.type;
    }

    async function updateMistake(id, input) {
      const cur = await one('SELECT subject_id, topic_id, cause_primary FROM mistakes WHERE id=? AND user_id=?', id, uid);
      if (!cur) throw notFound('Mistake');
      const v = validate(MISTAKE_SPEC, input, { partial: true });
      await checkRefs({ ...v, subject_id: v.subject_id ?? cur.subject_id, topic_id: v.topic_id === undefined ? (v.subject_id ? null : cur.topic_id) : v.topic_id });
      if (v.causes_secondary) v.causes_secondary = v.causes_secondary.filter((c) => c !== (v.cause_primary ?? cur.cause_primary));
      const cols = MCOLS.filter((c) => v[c] !== undefined);
      if (cols.length) {
        const row = toRow(v);
        await tx(async () => {
          await run(`UPDATE mistakes SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=? WHERE id=? AND user_id=?`, ...cols.map((c) => row[c]), now(), id, uid);
          await recompute(id);
        });
      }
      return getMistake(id);
    }

    async function getMistake(id) {
      const r = await one('SELECT * FROM mistakes WHERE id=? AND user_id=?', id, uid);
      if (!r) throw notFound('Mistake');
      return parseMistake(r);
    }

    async function deleteMistake(id) {
      if (!(await run('DELETE FROM mistakes WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Mistake');
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
          for (const id of ids) await run('DELETE FROM mistakes WHERE id=? AND user_id=?', id, uid);
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
      const m = await one('SELECT date_encountered FROM mistakes WHERE id=? AND user_id=?', mistakeId, uid);
      if (!m) throw notFound('Mistake');
      if (!REVIEW_OUTCOMES.includes(outcome) && outcome !== 'recurred') throw bad('outcome', `must be one of ${[...REVIEW_OUTCOMES, 'recurred'].join(', ')}`);
      date = date || todayStr();
      if (!isDate(date)) throw bad('date', 'must be a date YYYY-MM-DD');
      if (date < m.date_encountered) throw bad('date', 'review cannot be before the date the mistake was encountered');
      await tx(async () => {
        await run('INSERT INTO reviews (user_id, mistake_id, date, outcome, note, time_spent_sec, created_at) VALUES (?,?,?,?,?,?,?)', uid, mistakeId, date, outcome, note || null, time_spent_sec || null, now());
        await run('UPDATE mistakes SET next_review_override = NULL WHERE id = ? AND user_id = ?', mistakeId, uid); // a real review supersedes a manual date
        await recompute(mistakeId);
      });
      return getMistake(mistakeId);
    }
    async function updateReview(id, { date, outcome, note }) {
      const r = await one('SELECT * FROM reviews WHERE id=? AND user_id=?', id, uid);
      if (!r) throw notFound('Review');
      if (date !== undefined && !isDate(date)) throw bad('date', 'must be a date');
      if (outcome !== undefined && !OUTCOMES[outcome]) throw bad('outcome', 'invalid');
      await tx(async () => {
        await run('UPDATE reviews SET date=?, outcome=?, note=? WHERE id=? AND user_id=?', date ?? r.date, outcome ?? r.outcome, note === undefined ? r.note : note, id, uid);
        await recompute(r.mistake_id);
      });
      return getMistake(r.mistake_id);
    }
    async function deleteReview(id) {
      const r = await one('SELECT mistake_id FROM reviews WHERE id=? AND user_id=?', id, uid);
      if (!r) throw notFound('Review');
      await tx(async () => {
        await run('DELETE FROM reviews WHERE id=? AND user_id=?', id, uid);
        await recompute(r.mistake_id);
      });
      return getMistake(r.mistake_id);
    }

    /* ---------- tests ---------- */
    async function saveTest(id, input, streamId) {
      const v = validate(TEST_SPEC, input, { partial: !!id });
      if (!id) {
        v.stream_id = await needStream(streamId);
        v.user_id = uid;
      }
      if (v.breakdown !== undefined) {
        v.breakdown = cleanBreakdown(v.breakdown);
        for (const b of v.breakdown) {
          if (!(await exists('SELECT 1 x FROM subjects WHERE id=? AND user_id=?', b.subject_id, uid))) throw bad('breakdown', 'unknown subject');
          if (b.topic_id && !(await exists('SELECT 1 x FROM topics WHERE id=? AND user_id=?', b.topic_id, uid))) throw bad('breakdown', 'unknown topic');
        }
        v.breakdown = JSON.stringify(v.breakdown);
      }
      const c = (v.correct ?? 0) + (v.incorrect ?? 0);
      if (v.total_questions != null && c > v.total_questions) throw bad('correct', 'correct + incorrect exceeds total questions');
      if (v.marks_obtained != null && v.total_marks != null && v.marks_obtained > v.total_marks) throw bad('marks_obtained', 'exceeds total marks');
      const cols = Object.keys(v);
      const ts = now();
      if (id) {
        if (!(await exists('SELECT 1 x FROM tests WHERE id=? AND user_id=?', id, uid))) throw notFound('Test');
        if (cols.length) await run(`UPDATE tests SET ${cols.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=? AND user_id=?`, ...cols.map((k) => v[k]), ts, id, uid);
      } else {
        id = await ins(`INSERT INTO tests (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`, ...cols.map((k) => v[k]), ts, ts);
      }
      return parseTest(await one('SELECT * FROM tests WHERE id=? AND user_id=?', id, uid));
    }
    async function deleteTest(id) {
      if (!(await run('DELETE FROM tests WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Test'); // linked mistakes keep their text fields (test_id -> NULL)
      return { ok: true };
    }

    /* ---------- schedule / tracker ---------- */
    async function saveTask(id, input, repeatWeeks = 0, streamId) {
      const v = validate(TASK_SPEC, input, { partial: !!id });
      if (!id) {
        v.stream_id = await needStream(streamId);
        v.user_id = uid;
      }
      if (v.subject_id != null && !(await exists('SELECT 1 x FROM subjects WHERE id=? AND user_id=?', v.subject_id, uid))) throw bad('subject_id', 'unknown subject');
      if (v.topic_id != null && !(await exists('SELECT 1 x FROM topics WHERE id=? AND user_id=?', v.topic_id, uid))) throw bad('topic_id', 'unknown topic');
      const ts = now();
      if (id) {
        if (!(await exists('SELECT 1 x FROM tasks WHERE id=? AND user_id=?', id, uid))) throw notFound('Task');
        if ('done' in v) v.done_at = v.done ? ts : null;
        const cols = Object.keys(v);
        if (cols.length) await run(`UPDATE tasks SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=? AND user_id=?`, ...cols.map((k) => v[k]), id, uid);
        return strip(await one('SELECT * FROM tasks WHERE id=? AND user_id=?', id, uid));
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
      return strip(await one('SELECT * FROM tasks WHERE id=? AND user_id=?', ids[0], uid));
    }
    async function deleteTask(id) {
      if (!(await run('DELETE FROM tasks WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Task');
      return { ok: true };
    }
    async function addLog(input, streamId) {
      const v = validate(LOG_SPEC, input);
      v.stream_id = await needStream(streamId);
      v.user_id = uid;
      if (v.subject_id != null && !(await exists('SELECT 1 x FROM subjects WHERE id=? AND user_id=?', v.subject_id, uid))) throw bad('subject_id', 'unknown subject');
      const cols = Object.keys(v);
      const id = await ins(`INSERT INTO study_log (${cols.join(',')}, created_at) VALUES (${cols.map(() => '?').join(',')}, ?)`, ...cols.map((k) => v[k]), now());
      return strip(await one('SELECT * FROM study_log WHERE id=? AND user_id=?', id, uid));
    }
    async function deleteLog(id) {
      if (!(await run('DELETE FROM study_log WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Log entry');
      return { ok: true };
    }
    async function putProgress(topicId, input) {
      if (!(await exists('SELECT 1 x FROM topics WHERE id=? AND user_id=?', topicId, uid))) throw notFound('Topic');
      const cur = (await one('SELECT * FROM topic_progress WHERE topic_id=? AND user_id=?', topicId, uid)) || { studied: 0, revision_count: 0, pyq_done: 0, notes: null };
      const v = validate({ studied: { t: 'bool' }, revision_count: { t: 'int', min: 0, max: 99 }, pyq_done: { t: 'bool' }, notes: { t: 'str', len: 2000 } }, input, { partial: true });
      const n = { ...cur, ...v };
      await run(
        `INSERT INTO topic_progress (user_id, topic_id, studied, revision_count, pyq_done, notes, updated_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, topic_id) DO UPDATE SET studied=excluded.studied, revision_count=excluded.revision_count, pyq_done=excluded.pyq_done, notes=excluded.notes, updated_at=excluded.updated_at`,
        uid, topicId, n.studied ? 1 : 0, n.revision_count || 0, n.pyq_done ? 1 : 0, n.notes ?? null, now(),
      );
      return strip(await one('SELECT * FROM topic_progress WHERE topic_id=? AND user_id=?', topicId, uid));
    }

    /* ---------- syllabus + causes configuration ---------- */
    async function saveSubject(id, input, streamId) {
      const v = validate({ name: { t: 'str', req: true, len: 200 }, section: { t: 'str', len: 200 }, importance: { t: 'int', min: 1, max: 5 } }, input, { partial: !!id });
      try {
        if (id) {
          if (!(await exists('SELECT 1 x FROM subjects WHERE id=? AND user_id=?', id, uid))) throw notFound('Subject');
          const cols = Object.keys(v);
          if (cols.length) await run(`UPDATE subjects SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=? AND user_id=?`, ...cols.map((k) => v[k]), id, uid);
        } else {
          const sid = await needStream(streamId);
          const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM subjects WHERE stream_id=? AND user_id=?', sid, uid)).n;
          id = await ins('INSERT INTO subjects (user_id, stream_id, section, name, importance, sort) VALUES (?,?,?,?,?,?)', uid, sid, v.section ?? null, v.name, v.importance ?? 3, sort);
        }
      } catch (e) {
        if (e.code === '23505') throw bad('name', 'a subject with this name already exists');
        throw e;
      }
      return strip(await one('SELECT * FROM subjects WHERE id=? AND user_id=?', id, uid));
    }
    async function deleteSubject(id) {
      if (await exists('SELECT 1 x FROM mistakes WHERE subject_id=? AND user_id=?', id, uid)) throw bad('subject', 'has recorded mistakes; reassign or delete them first');
      if (!(await run('DELETE FROM subjects WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Subject');
      return { ok: true };
    }
    async function saveTopic(id, input) {
      const v = validate({ subject_id: { t: 'int', req: true }, parent_id: { t: 'int' }, name: { t: 'str', req: true, len: 300 }, importance: { t: 'int', min: 1, max: 5 } }, input, { partial: !!id });
      if (v.parent_id) {
        const p = await one('SELECT subject_id, parent_id FROM topics WHERE id=? AND user_id=?', v.parent_id, uid);
        if (!p) throw bad('parent_id', 'unknown parent topic');
        if (p.parent_id) throw bad('parent_id', 'subtopics can only be one level deep');
        if (v.subject_id && p.subject_id !== v.subject_id) throw bad('parent_id', 'parent is in another subject');
      }
      if (id) {
        if (!(await exists('SELECT 1 x FROM topics WHERE id=? AND user_id=?', id, uid))) throw notFound('Topic');
        delete v.subject_id;
        delete v.parent_id; // moving topics is not supported; keeps references consistent
        const cols = Object.keys(v);
        if (cols.length) await run(`UPDATE topics SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=? AND user_id=?`, ...cols.map((k) => v[k]), id, uid);
      } else {
        if (!(await exists('SELECT 1 x FROM subjects WHERE id=? AND user_id=?', v.subject_id, uid))) throw bad('subject_id', 'unknown subject');
        const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM topics WHERE subject_id=? AND user_id=?', v.subject_id, uid)).n;
        id = await ins('INSERT INTO topics (user_id, subject_id, parent_id, name, importance, sort) VALUES (?,?,?,?,?,?)', uid, v.subject_id, v.parent_id ?? null, v.name, v.importance ?? 3, sort);
      }
      return strip(await one('SELECT * FROM topics WHERE id=? AND user_id=?', id, uid));
    }
    async function deleteTopic(id) {
      const used = (await one('SELECT COUNT(*)::int AS n FROM mistakes WHERE (topic_id=? OR subtopic_id=?) AND user_id=?', id, id, uid)).n;
      // mistakes keep existing (topic_id becomes NULL via ON DELETE SET NULL); the caller is told how many were detached
      if (!(await run('DELETE FROM topics WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Topic');
      return { ok: true, detached: used };
    }
    async function saveCause(id, input) {
      const v = validate({ name: { t: 'str', req: true, len: 200 }, description: { t: 'str', len: 1000 }, guidance: { t: 'str', len: 3000 } }, input, { partial: !!id });
      if (id) {
        if (!(await exists('SELECT 1 x FROM causes WHERE id=? AND user_id=?', id, uid))) throw notFound('Cause');
        const cols = Object.keys(v);
        if (cols.length) await run(`UPDATE causes SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=? AND user_id=?`, ...cols.map((k) => v[k]), id, uid);
      } else {
        const sort = (await one('SELECT COALESCE(MAX(sort),0)+1 AS n FROM causes WHERE user_id=?', uid)).n;
        id = await ins('INSERT INTO causes (user_id, name, description, guidance, sort) VALUES (?,?,?,?,?)', uid, v.name, v.description ?? null, v.guidance ?? null, sort);
      }
      return strip(await one('SELECT * FROM causes WHERE id=? AND user_id=?', id, uid));
    }
    async function deleteCause(id) {
      if (await exists('SELECT 1 x FROM mistakes WHERE cause_primary=? AND user_id=?', id, uid)) throw bad('cause', 'is the primary cause of existing mistakes; reassign them first');
      if (!(await run('DELETE FROM causes WHERE id=? AND user_id=?', id, uid)).changes) throw notFound('Cause');
      return { ok: true };
    }

    /* ---------- screenshots ---------- */
    async function saveAttachment(name, mime, buf) {
      await run('INSERT INTO attachments (name, user_id, mime, data, created_at) VALUES (?,?,?,?,?)', name, uid, mime, buf, now());
      return { file: name };
    }
    async function getAttachment(name) {
      const r = await one('SELECT mime, data FROM attachments WHERE name=? AND user_id=?', name, uid);
      return r ? { mime: r.mime, data: Buffer.from(r.data) } : null;
    }

    /* ---------- everything the UI needs for the chosen branch ---------- */
    // ONE round trip: a single statement returns every list as JSON. (Each query is a network hop between Vercel and
    // Supabase, so fifteen separate queries made every page load and every click slow.)  $1 = user, $2 = chosen branch.
    const agg = (select, order = '') => `COALESCE((SELECT json_agg(t${order ? ' ORDER BY ' + order : ''}) FROM (${select}) t), '[]'::json)`;
    const IN_SUBJECTS = 'SELECT id FROM subjects WHERE user_id = $1 AND stream_id = $2';
    const BOOTSTRAP_SQL = `SELECT
      (SELECT row_to_json(u) FROM (SELECT id, email, name FROM users WHERE id = $1) u) AS "user",
      ${agg('SELECT key, value FROM settings WHERE user_id = $1')} AS settings,
      ${agg('SELECT * FROM causes WHERE user_id = $1', 't.sort, t.id')} AS causes,
      ${agg(`SELECT s.id, s.code, s.name, s.sort,
          (SELECT COUNT(*)::int FROM subjects x WHERE x.stream_id = s.id) AS subjects,
          (SELECT COUNT(*)::int FROM mistakes m JOIN subjects x ON x.id = m.subject_id WHERE x.stream_id = s.id AND m.archived = 0) AS mistakes
        FROM streams s WHERE s.user_id = $1`, 't.sort, t.id')} AS streams,
      ${agg('SELECT * FROM subjects WHERE user_id = $1 AND stream_id = $2', 't.sort, t.id')} AS subjects,
      ${agg(`SELECT * FROM topics WHERE user_id = $1 AND subject_id IN (${IN_SUBJECTS})`, 't.sort, t.id')} AS topics,
      ${agg(`SELECT * FROM mistakes WHERE user_id = $1 AND subject_id IN (${IN_SUBJECTS})`, 't.id')} AS mistakes,
      ${agg(`SELECT r.* FROM reviews r JOIN mistakes m ON m.id = r.mistake_id WHERE r.user_id = $1 AND m.subject_id IN (${IN_SUBJECTS})`, 't.date, t.id')} AS reviews,
      ${agg('SELECT * FROM tests WHERE user_id = $1 AND stream_id = $2', 't.date, t.id')} AS tests,
      ${agg('SELECT * FROM tasks WHERE user_id = $1 AND stream_id = $2', 't.date, t.id')} AS tasks,
      ${agg('SELECT * FROM study_log WHERE user_id = $1 AND stream_id = $2', 't.date, t.id')} AS study_log,
      ${agg(`SELECT p.* FROM topic_progress p JOIN topics tp ON tp.id = p.topic_id WHERE p.user_id = $1 AND tp.subject_id IN (${IN_SUBJECTS})`)} AS progress`;
    async function bootstrap(streamId) {
      const r = (await exec(BOOTSTRAP_SQL, [uid, Number(streamId) || 0])).rows[0];
      // a valid cookie for an account that no longer exists (e.g. the database was recreated) counts as signed out
      if (!r.user) throw Object.assign(new Error('login'), { status: 401 });
      const have = new Set(r.streams.map((x) => x.code));
      const base = { today: todayStr(), user: r.user, streams: r.streams.map(({ sort, ...x }) => x), available: BRANCHES.filter((b) => !have.has(b.code)), settings: buildSettings(r.settings), causes: r.causes.map(strip) };
      const stream = base.streams.find((x) => x.id === Number(streamId));
      if (!stream) return { ...base, needsStream: true };
      return {
        ...base, stream,
        subjects: r.subjects.map(strip), topics: r.topics.map(strip), mistakes: r.mistakes.map(parseMistake), reviews: r.reviews.map(strip),
        tests: r.tests.map(parseTest), tasks: r.tasks.map(strip), studyLog: r.study_log.map(strip), progress: r.progress.map(strip),
      };
    }

    /* ---------- demo data (bulk; see src/demo.js) ---------- */
    const TEST_COLS = ['user_id', 'stream_id', 'name', 'provider', 'date', 'type', 'total_questions', 'total_marks', 'marks_obtained', 'correct', 'incorrect', 'negative_marks', 'breakdown', 'created_at', 'updated_at'];
    const MISTAKE_COLS = ['user_id', 'date_encountered', 'subject_id', 'topic_id', 'test_type', 'provider', 'test_name', 'test_id', 'question_no', 'question_text', 'solution', 'cause_primary', 'causes_secondary',
      'difficulty', 'confidence', 'time_spent_sec', 'marks_lost', 'severity', 'tags', 'lesson', 'guessed', 'skipped_solvable', 'status', 'stage', 'streak', 'fail_count', 'recurrence_count', 'reopen_count',
      'review_count', 'success_count', 'last_review', 'last_success', 'mastered_at', 'next_review', 'archived', 'created_at', 'updated_at'];
    /** Insert pre-validated demo rows in a few batched statements. Every row is stamped with this user (and branch). */
    async function insertDemo({ tests, mistakes, tasks, logs, progress }, streamId) {
      const sid = await needStream(streamId);
      const ts = now();
      return tx(async () => {
        const testIds = await insertMany('tests', TEST_COLS, tests.map((t) => ({ ...t, user_id: uid, stream_id: sid, breakdown: '[]', created_at: ts, updated_at: ts })), { returning: true });
        const rows = mistakes.map((m) => ({ ...m.fields, user_id: uid, test_id: m.testIdx == null ? null : testIds[m.testIdx], causes_secondary: '[]', tags: JSON.stringify(m.fields.tags || []), archived: 0, created_at: ts, updated_at: ts }));
        const mistakeIds = await insertMany('mistakes', MISTAKE_COLS, rows, { returning: true });
        const reviews = mistakes.flatMap((m, i) => m.events.map((e) => ({ user_id: uid, mistake_id: mistakeIds[i], date: e.date, outcome: e.outcome, created_at: ts })));
        await insertMany('reviews', ['user_id', 'mistake_id', 'date', 'outcome', 'created_at'], reviews);
        await insertMany('tasks', ['user_id', 'stream_id', 'date', 'title', 'subject_id', 'kind', 'minutes', 'done', 'done_at', 'created_at'], tasks.map((t) => ({ ...t, user_id: uid, stream_id: sid, done_at: t.done ? ts : null, created_at: ts })));
        await insertMany('study_log', ['user_id', 'stream_id', 'date', 'subject_id', 'minutes', 'activity', 'note', 'created_at'], logs.map((l) => ({ ...l, user_id: uid, stream_id: sid, created_at: ts })));
        await insertMany('topic_progress', ['user_id', 'topic_id', 'studied', 'revision_count', 'pyq_done', 'notes', 'updated_at'], progress.map((p) => ({ ...p, user_id: uid, updated_at: ts })),
          { suffix: ' ON CONFLICT (user_id, topic_id) DO UPDATE SET studied=excluded.studied, revision_count=excluded.revision_count, pyq_done=excluded.pyq_done, notes=excluded.notes, updated_at=excluded.updated_at' });
        return { mistakes: mistakeIds.length, tests: testIds.length };
      });
    }
    /** Delete only the demo rows ("sample" tag / "[Sample]" names / note "sample"), across all of this user's branches. */
    async function removeDemoRows() {
      return tx(async () => ({
        mistakes: (await run(`DELETE FROM mistakes WHERE user_id = ? AND tags LIKE '%"sample"%'`, uid)).changes, // reviews go with them (ON DELETE CASCADE)
        tests: (await run(`DELETE FROM tests WHERE user_id = ? AND name LIKE '[Sample]%'`, uid)).changes,
        tasks: (await run(`DELETE FROM tasks WHERE user_id = ? AND title LIKE '[Sample]%'`, uid)).changes,
        log: (await run(`DELETE FROM study_log WHERE user_id = ? AND note = 'sample'`, uid)).changes,
        ticks: (await run(`UPDATE topic_progress SET studied = 0, revision_count = 0, pyq_done = 0, notes = '' WHERE user_id = ? AND notes = 'sample'`, uid)).changes,
      }));
    }

    return {
      bootstrap, listStreams, availableBranches, addBranch, getSettings, putSetting, recomputeAll,
      createMistake, updateMistake, getMistake, deleteMistake, duplicateMistake, bulk,
      addReview, updateReview, deleteReview,
      saveTest, deleteTest, saveTask, deleteTask, addLog, deleteLog, putProgress,
      saveSubject, deleteSubject, saveTopic, deleteTopic, saveCause, deleteCause,
      saveAttachment, getAttachment,
      insertDemo, removeDemoRows,
    };
  }

  return { createUser, verifyUser, getUser, resetPassword, forUser };
}
