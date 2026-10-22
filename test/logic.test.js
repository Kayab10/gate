import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, applyEvent, initialState, DEFAULT_SRS, displayStatus } from '../public/shared/srs.js';
import { priorityScore } from '../public/shared/priority.js';
import { summary, testStats, weekly, causeStats } from '../public/shared/analytics.js';
import { buildPlan } from '../public/shared/planner.js';
import { addDays, diffDays, weekStart } from '../public/shared/dates.js';
import { diagnose, questionMetrics, trend, weeklyMinutes } from '../public/shared/diagnostics.js';

const ev = (date, outcome, id) => ({ date, outcome, id });

test('dates: arithmetic is DST-safe and week starts Monday', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(diffDays('2027-02-01', '2026-10-10'), 114);
  assert.equal(weekStart('2026-10-10'), '2026-10-05'); // Saturday -> Monday
  assert.equal(weekStart('2026-10-11'), '2026-10-05'); // Sunday
});

test('srs: new mistake first review is +1 day, intervals measured from the previous review', () => {
  const s0 = initialState('2026-10-10');
  assert.equal(s0.next_review, '2026-10-11');
  const s = replay('2026-10-10', [ev('2026-10-11', 'independent', 1)]);
  assert.equal(s.next_review, '2026-10-14'); // +3
  const s2 = replay('2026-10-10', [ev('2026-10-11', 'independent', 1), ev('2026-10-14', 'independent', 2)]);
  assert.equal(s2.next_review, '2026-10-21'); // +7
  assert.equal(s2.status, 'improving');
});

test('srs: overdue review is scheduled from the actual review date', () => {
  const s = replay('2026-10-10', [ev('2026-10-20', 'independent', 1)]); // due 10-11, done 10-20
  assert.equal(s.next_review, '2026-10-23');
});

test('srs: mastery requires repeated independent successes, never one click', () => {
  let ev1 = [ev('2026-10-11', 'independent', 1)];
  assert.notEqual(replay('2026-10-10', ev1).status, 'mastered');
  const all = [ev('2026-10-11', 'independent', 1), ev('2026-10-14', 'independent', 2), ev('2026-10-21', 'independent', 3), ev('2026-11-04', 'independent', 4)];
  assert.notEqual(replay('2026-10-10', all.slice(0, 3)).status, 'mastered');
  const m = replay('2026-10-10', all);
  assert.equal(m.status, 'mastered');
  assert.equal(m.mastered_at, '2026-11-04');
  assert.equal(m.next_review, addDays('2026-11-04', DEFAULT_SRS.maintenanceDays));
});

test('srs: hints and partial solves do not count towards mastery', () => {
  const evs = [ev('2026-10-11', 'independent', 1), ev('2026-10-14', 'hint', 2), ev('2026-10-15', 'partial', 3)];
  const s = replay('2026-10-10', evs);
  assert.equal(s.streak, 0);
  assert.notEqual(s.status, 'mastered');
});

test('srs: failure shortens the interval and reopens a mastered mistake', () => {
  const evs = [ev('2026-10-11', 'independent', 1), ev('2026-10-14', 'independent', 2), ev('2026-10-21', 'independent', 3), ev('2026-11-04', 'independent', 4)];
  const m = replay('2026-10-10', evs);
  assert.equal(m.status, 'mastered');
  const r = applyEvent(m, ev('2026-12-01', 'failed'));
  assert.equal(r.status, 'reopened');
  assert.equal(r.next_review, '2026-12-02');
  assert.equal(r.stage, 0);
  assert.equal(r.reopen_count, 1);
  assert.equal(r.mastered_at, null);
  // recurrence in a later test behaves the same and is counted separately
  const r2 = applyEvent(m, ev('2026-12-01', 'recurred'));
  assert.equal(r2.status, 'reopened');
  assert.equal(r2.recurrence_count, 1);
  assert.equal(r2.fail_count, 0);
});

test('srs: several reviews on the same day cannot farm progress', () => {
  const s = replay('2026-10-10', [ev('2026-10-11', 'independent', 1), ev('2026-10-11', 'independent', 2), ev('2026-10-11', 'independent', 3)]);
  assert.equal(s.streak, 1);
  assert.equal(s.review_count, 1);
  assert.equal(s.next_review, '2026-10-14');
  // but a failure the same day after a success still counts
  const f = replay('2026-10-10', [ev('2026-10-11', 'independent', 1), ev('2026-10-11', 'failed', 2)]);
  assert.equal(f.streak, 0);
  assert.equal(f.fail_count, 1);
});

test('srs: replay is order-independent for input order and respects changed dates', () => {
  const a = [ev('2026-10-14', 'independent', 2), ev('2026-10-11', 'independent', 1)];
  assert.equal(replay('2026-10-10', a).next_review, '2026-10-21');
  // moving the mistake date later re-derives the first due date
  assert.equal(replay('2026-10-12', []).next_review, '2026-10-13');
});

test('srs: custom intervals are honoured', () => {
  const cfg = { intervals: [2, 5] };
  assert.equal(initialState('2026-10-10', cfg).next_review, '2026-10-12');
  assert.equal(replay('2026-10-10', [ev('2026-10-12', 'independent', 1)], cfg).next_review, '2026-10-17');
  // beyond the last configured interval the last one is reused
  const s = replay('2026-10-10', [ev('2026-10-12', 'independent', 1), ev('2026-10-17', 'independent', 2)], { ...cfg, masteryStreak: 9 });
  assert.equal(s.next_review, '2026-10-22');
});

test('srs: forgot concept resets stage like a failure; display status derives due_first', () => {
  const s = replay('2026-10-10', [ev('2026-10-11', 'independent', 1), ev('2026-10-14', 'forgot', 2)]);
  assert.equal(s.stage, 0);
  assert.equal(s.next_review, '2026-10-15');
  assert.equal(displayStatus({ status: 'new', next_review: '2026-10-11' }, '2026-10-11'), 'due_first');
  assert.equal(displayStatus({ status: 'new', next_review: '2026-10-12' }, '2026-10-11'), 'new');
});

const mk = (o = {}) => ({
  id: 1, subject_id: 1, topic_id: 1, date_encountered: '2026-10-01', status: 'new', next_review: '2026-10-02', archived: false,
  recurrence_count: 0, fail_count: 0, severity: 3, marks_lost: 0, confidence: null, last_success: null, success_count: 0, ...o,
});

test('priority: transparent components that explain the score', () => {
  const r = priorityScore(mk({ recurrence_count: 2, fail_count: 1, marks_lost: 2, severity: 4, confidence: 5 }), { today: '2026-10-10', importance: 3 });
  assert.ok(r.score > 0);
  const total = r.parts.reduce((a, p) => a + p.points, 0);
  assert.ok(Math.abs(total - r.score) < 0.2);
  assert.ok(r.parts.find((p) => p.key === 'recurrence').points === 30);
  assert.ok(r.parts.find((p) => p.key === 'overconfidence'));
  assert.ok(r.reason.length > 0);
  // deterministic
  assert.deepEqual(r, priorityScore(mk({ recurrence_count: 2, fail_count: 1, marks_lost: 2, severity: 4, confidence: 5 }), { today: '2026-10-10', importance: 3 }));
});

test('priority: weights are configurable and neutral importance adds nothing', () => {
  const base = priorityScore(mk(), { today: '2026-10-10', importance: 3 });
  assert.equal(base.parts.find((p) => p.key === 'importance'), undefined);
  const heavy = priorityScore(mk({ recurrence_count: 1 }), { today: '2026-10-10', importance: 3 }, { recurrence: 100 });
  assert.equal(heavy.parts.find((p) => p.key === 'recurrence').points, 100);
  const mastered = priorityScore(mk({ status: 'mastered', next_review: '2027-01-01' }), { today: '2026-10-10', importance: 3 });
  assert.ok(mastered.score < base.score);
});

test('analytics: empty database yields empty-safe results', () => {
  const s = summary([], [], '2026-10-10');
  assert.equal(s.total, 0);
  assert.equal(s.completionRate, null);
  assert.deepEqual(weekly([], [], [], '2026-10-10'), []);
  assert.equal(causeStats([], [{ id: 1, name: 'x' }]).mostFrequent, null);
});

test('analytics: summary counts due/overdue/repeated/mastered and ignores archived', () => {
  const ms = [
    mk({ id: 1, next_review: '2026-10-10' }),
    mk({ id: 2, next_review: '2026-10-08' }),
    mk({ id: 3, status: 'mastered', mastered_at: '2026-10-01', next_review: '2026-12-01' }),
    mk({ id: 4, recurrence_count: 1, fail_count: 1, next_review: '2026-10-20' }),
    mk({ id: 5, archived: true, next_review: '2026-10-01' }),
  ];
  const s = summary(ms, [], '2026-10-10');
  assert.equal(s.total, 4);
  assert.equal(s.dueToday, 2); // due now = today + overdue (same as the review queue)
  assert.equal(s.overdue, 1);
  assert.equal(s.mastered, 1);
  assert.equal(s.repeated, 1);
  assert.equal(s.unresolved, 3);
});

test('analytics: accuracy definitions are kept separate and need the data', () => {
  const t = { total_questions: 65, total_marks: 100, marks_obtained: 40, correct: 30, incorrect: 20 };
  const st = testStats(t);
  assert.equal(st.accuracyAll.toFixed(3), (30 / 65).toFixed(3));
  assert.equal(st.accuracyAttempted, 30 / 50);
  assert.equal(st.unattempted, 15);
  const sparse = testStats({ marks_obtained: 40, total_marks: 100 });
  assert.equal(sparse.accuracyAll, null);
  assert.equal(sparse.accuracyAttempted, null);
  assert.equal(sparse.scorePct, 0.4);
});

test('analytics: weekly error rate uses attempted questions as denominator', () => {
  const tests = [{ date: '2026-10-06', breakdown: [{ subject_id: 1, correct: 8, incorrect: 2 }] }];
  const w = weekly([mk({ date_encountered: '2026-10-06' })], [], tests, '2026-10-10');
  assert.equal(w.length, 1);
  assert.equal(w[0].mistakes, 1);
  assert.equal(w[0].errorRate, 0.2);
});

test('planner: orders buckets, fits the time budget, skips what does not fit', () => {
  const subjects = [{ id: 1, importance: 3 }];
  const topics = [{ id: 1, subject_id: 1, parent_id: null, importance: 3 }];
  const ms = [
    mk({ id: 1, next_review: '2026-10-05', difficulty: 'hard' }), // overdue, 8 min
    mk({ id: 2, next_review: '2026-10-10', difficulty: 'easy' }), // due today, 3 min
    mk({ id: 3, next_review: '2026-10-10', recurrence_count: 2, difficulty: 'medium' }), // high impact, 5 min
    mk({ id: 4, status: 'mastered', next_review: '2026-10-09', difficulty: 'easy' }), // maintenance
  ];
  const base = { mistakes: ms, subjects, topics, tests: [], reviews: [], today: '2026-10-10', settings: {} };
  const full = buildPlan({ ...base, budgetMin: null });
  assert.equal(full.items[0].mistake.id, 1);
  const order = full.items.map((i) => i.bucket);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(full.items.some((i) => i.bucket === 4));
  const tight = buildPlan({ ...base, budgetMin: 10 });
  assert.ok(tight.usedMin <= 10);
  assert.equal(tight.items[0].mistake.id, 1);
  assert.ok(tight.skipped.length > 0);
});

import { explainDbError, checkUrl, describeUrl } from '../src/dbdiag.js';

test('db diagnosis: explains common Supabase/Vercel connection mistakes in plain English, never echoing the password', () => {
  const ok = 'postgresql://postgres.abcdefgh:s3cretPw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
  assert.equal(checkUrl(ok), null);
  assert.match(checkUrl('').message, /not set/);
  assert.match(checkUrl('postgresql://postgres.abcd:pw@…pooler.supabase.com:6543/postgres').message, /shortened/);
  assert.match(checkUrl('postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-x.pooler.supabase.com:6543/postgres').message, /placeholder/);
  assert.match(checkUrl('https://xyz.supabase.co').message, /instead of postgresql/);
  assert.match(checkUrl('not a url').message, /not a valid/);
  assert.match(checkUrl('postgresql://postgres:pw@aws-0-x.pooler.supabase.com:6543/postgres').message, /postgres\.<project-ref>/);
  assert.match(checkUrl('postgresql://postgres.abc@aws-0-x.pooler.supabase.com:6543/postgres').message, /no password/);

  assert.match(explainDbError({ code: '28P01', message: 'password authentication failed for user "x"' }, ok).message, /rejected the password/);
  assert.match(explainDbError({ message: 'Tenant or user not found' }, ok).message, /username or region/);
  assert.match(explainDbError({ code: 'ENOTFOUND' }, 'postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres').hint, /Direct connection/);
  assert.match(explainDbError({ code: 'ECONNREFUSED' }, ok).message, /refused/);
  assert.match(explainDbError({ code: 'ETIMEDOUT' }, ok).hint, /paused/);
  assert.match(explainDbError(new Error('something odd'), ok).message, /something odd/);
  for (const e of [{ code: '28P01', message: 'x' }, { code: 'ENOTFOUND' }, new Error('boom')]) assert.ok(!JSON.stringify(explainDbError(e, ok)).includes('s3cretPw'));

  const d = describeUrl(ok);
  assert.deepEqual([d.host, d.port, d.pooler, d.usernameLooksRight, d.passwordLength], ['aws-0-ap-south-1.pooler.supabase.com', '6543', true, true, 8]);
  assert.ok(!JSON.stringify(d).includes('s3cretPw'));
});

test('vercel function: /api/health and API calls report a clear reason when the database cannot be reached', async () => {
  const mod = await import('../api/index.js');
  const call = async (url) => {
    let status, body = '';
    await mod.default({ url, method: 'GET', headers: {} }, { writeHead: (s) => (status = s), end: (b) => (body += b) });
    return { status, body: JSON.parse(body) };
  };
  const saved = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    let r = await call('/api/health');
    assert.equal(r.body.ok, false);
    assert.match(r.body.steps[0].message, /not set/);
    r = await call('/api/session');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /DATABASE_URL is not set/);

    process.env.DATABASE_URL = 'postgresql://postgres.abcd:topsecretpw@127.0.0.1:1/postgres'; // nothing listens on port 1
    r = await call('/api/health');
    assert.equal(r.body.ok, false);
    assert.equal(r.body.steps[1].ok, false);
    assert.match(r.body.steps[1].message, /refused/);
    assert.ok(!JSON.stringify(r.body).includes('topsecretpw'));
    r = await call('/api/session');
    assert.equal(r.status, 500);
    assert.match(r.body.error, /Cannot reach the database/);
    assert.ok(!JSON.stringify(r.body).includes('topsecretpw'));

    process.env.DATABASE_URL = 'postgresql://postgres.abcd:topsecretpw@no-such-host.invalid:6543/postgres';
    r = await call('/api/health');
    assert.match(r.body.steps[1].message, /could not be found/);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

const T = (id, date, tier, o) => ({ id, date, tier, name: `t${id}`, total_marks: 100, marks_obtained: 50, total_questions: 65, correct: 30, incorrect: 10, negative_marks: 3, ...o });
const base = { concepts: [], subjects: [], topics: [], progress: [], studyLog: [], today: '2026-10-22', examDate: '', weekStartOf: weekStart };

test('diagnostics: question metrics and attempt/accuracy findings', () => {
  const q = questionMetrics([T(1, '2026-10-01', 'mock', { correct: 20, incorrect: 5 }), T(2, '2026-10-08', 'mock', { correct: undefined })]);
  assert.equal(q.length, 1); // the test without counts is ignored
  assert.equal(q[0].unattempted, 40);
  assert.equal(q[0].accuracy, 0.8);
  // accurate but low attempt rate
  let d = diagnose({ ...base, tests: [T(1, '2026-10-01', 'mock', { correct: 30, incorrect: 5, total_questions: 65 })] });
  assert.ok(d.insights.some((i) => i.level === 'warn' && /leaving marks/.test(i.title)));
  // many attempts, poor accuracy, heavy negatives
  d = diagnose({ ...base, tests: [T(1, '2026-10-01', 'mock', { correct: 20, incorrect: 40, total_questions: 65, marks_obtained: 20, negative_marks: 13 })] });
  assert.ok(d.insights.some((i) => i.level === 'bad' && /shots in the dark/.test(i.title)));
  assert.ok(d.insights.some((i) => /Negative marking/.test(i.title)));
  // nothing recorded: a hint, not a crash
  assert.equal(diagnose({ ...base, tests: [] }).insights[0].level, 'info');
});

test('diagnostics: trend, weekly minutes and subject findings', () => {
  const tests = [40, 42, 44, 55, 58, 60].map((m, i) => T(i + 1, `2026-09-${String(i + 1).padStart(2, '0')}`, 'weekly', { marks_obtained: m }));
  const t = trend(tests);
  assert.ok(t.delta > 10);
  assert.equal(trend(tests.slice(0, 3)), null);
  const w = weeklyMinutes([{ date: '2026-10-22', minutes: 60 }, { date: '2026-10-19', minutes: 30 }, { date: '2026-10-12', minutes: 20 }], '2026-10-22', 3, weekStart);
  assert.deepEqual(w.map((x) => x.min), [0, 20, 90]);
  const subjects = [{ id: 1, name: 'ML' }, { id: 2, name: 'DB' }];
  const concepts = [1, 2].map((i) => ({ id: i, subject_id: 1, kind: 'struggle', status: 'new', next_review: '2026-10-30' })).concat([{ id: 9, subject_id: 2, kind: 'remember', status: 'new', next_review: '2026-10-30' }]);
  const d = diagnose({ ...base, tests: [], subjects, concepts, studyLog: [{ date: '2026-10-20', minutes: 30, subject_id: 1 }] });
  assert.ok(d.insights.some((i) => /ML: concepts piling up/.test(i.title)));
  assert.ok(d.insights.some((i) => /Untouched/.test(i.title) && /DB/.test(i.text)));
});
