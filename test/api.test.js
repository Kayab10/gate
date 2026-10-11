import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/handler.js';
import { pgliteAdapter } from '../src/db.js';
import { addDays, todayStr } from '../public/shared/dates.js';

const PW = 'correct horse battery';

/** Boots the app on PGlite. `call` is user A (a@example.com, branch ME, already signed in with ME chosen). */
async function boot(dir, { inviteCode = '', noUser = false } = {}) {
  const db = await pgliteAdapter(path.join(dir, 'pg'));
  const app = await createApp({ db, secret: 'test-secret', inviteCode });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  /** A browser: own cookie jar and own chosen stream. */
  const makeClient = () => {
    let cookie = '';
    let stream = null;
    const call = async (method, url, body, headers = {}) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(stream ? { 'X-Stream': String(stream) } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
      return { status: res.status, body: await res.json(), setCookie: sc };
    };
    const c = {
      call,
      getCookie: () => cookie,
      setCookie: (v) => (cookie = v),
      useStream: (id) => (stream = id),
      async signup(email, branch, extra = {}) {
        const r = await call('POST', '/api/signup', { email, password: PW, name: email.split('@')[0], branch, ...extra });
        if (r.status === 200) c.useStream((await call('GET', '/api/streams')).body.streams[0].id);
        return r;
      },
      async login(email, password = PW) {
        const r = await call('POST', '/api/login', { email, password });
        if (r.status === 200) c.useStream((await call('GET', '/api/streams')).body.streams[0]?.id ?? null);
        return r;
      },
    };
    return c;
  };

  const a = makeClient();
  if (!noUser) assert.equal((await a.signup('a@example.com', 'ME')).status, 200);
  return { app, base, makeClient, a, call: a.call, getCookie: a.getCookie, useStream: a.useStream };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
const D = (n) => addDays(todayStr(), n);
const boots = async (c) => (await c.call('GET', '/api/bootstrap')).body;

test('fresh account: own copy of the ME syllabus and causes, no mistakes, empty-state safe', async () => {
  const { app, call } = await boot(tmp());
  const body = await boots({ call });
  assert.equal(body.user.email, 'a@example.com');
  assert.equal(body.stream.code, 'ME');
  assert.deepEqual(body.streams.map((s) => s.code), ['ME']);
  assert.deepEqual(body.available.map((s) => s.code), ['DA']);
  assert.equal(body.subjects.length, 24);
  assert.ok(body.subjects.some((s) => s.name === 'Thermodynamics' && s.section === 'Fluid Mechanics and Thermal Sciences'));
  assert.ok(body.topics.length > 150);
  assert.equal(body.causes.length, 12);
  assert.equal(body.mistakes.length, 0);
  assert.equal(body.tests.length, 0);
  assert.equal(body.user.pw_hash, undefined);
  assert.deepEqual(body.settings.srs.intervals, [1, 3, 7, 14, 30]);
  await app.close();
});

test('create / edit / duplicate / archive / delete a mistake with validation', async () => {
  const { app, call } = await boot(tmp());
  const boot0 = await boots({ call });
  const th = boot0.subjects.find((s) => s.name === 'Thermodynamics');
  const topic = boot0.topics.find((t) => t.subject_id === th.id);
  const cause = boot0.causes[0].id;

  let r = await call('POST', '/api/mistakes', { subject_id: th.id, cause_primary: cause }); // quick-add: subject + cause only
  assert.equal(r.status, 200);
  const id = r.body.id;
  assert.equal(r.body.status, 'new');
  assert.equal(r.body.next_review, D(1));
  assert.equal(r.body.user_id, undefined);

  r = await call('POST', '/api/mistakes', { subject_id: th.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /cause_primary/);
  assert.equal((await call('POST', '/api/mistakes', { subject_id: th.id, cause_primary: cause, confidence: 9 })).status, 400);
  assert.equal((await call('POST', '/api/mistakes', { subject_id: 999999, cause_primary: cause })).status, 400);
  const other = boot0.topics.find((t) => t.subject_id !== th.id);
  assert.equal((await call('POST', '/api/mistakes', { subject_id: th.id, topic_id: other.id, cause_primary: cause })).status, 400);

  r = await call('PUT', `/api/mistakes/${id}`, { topic_id: topic.id, marks_lost: 2, tags: ['svm', 'kernel'], question_text: 'Why does entropy rise?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.marks_lost, 2);
  assert.deepEqual(r.body.tags, ['svm', 'kernel']);

  r = await call('POST', `/api/mistakes/${id}/duplicate`, { date: D(0) });
  assert.notEqual(r.body.id, id);
  assert.equal(r.body.question_text, 'Why does entropy rise?');

  assert.equal((await call('PUT', `/api/mistakes/${id}`, { archived: true })).body.archived, true);
  assert.equal((await call('DELETE', `/api/mistakes/${id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/mistakes/${id}`)).status, 404);
  await app.close();
});

test('review workflow: next date, mastery needs repeats, failure reopens, undo re-derives', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const cause = b.causes[0].id;
  const created = (await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: cause, date_encountered: D(-60) })).body;
  const id = created.id;
  assert.equal(created.next_review, D(-59));

  let m;
  for (const d of [D(-59), D(-56), D(-49), D(-35)]) m = (await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'independent', date: d })).body;
  assert.equal(m.status, 'mastered');

  m = (await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'failed', date: D(-1) })).body;
  assert.equal(m.status, 'reopened');
  assert.equal(m.next_review, D(0));
  assert.equal(m.reopen_count, 1);

  const rid = (await boots({ call })).reviews.find((r) => r.outcome === 'failed').id;
  m = (await call('DELETE', `/api/reviews/${rid}`)).body;
  assert.equal(m.status, 'mastered');

  m = (await call('PUT', `/api/mistakes/${id}`, { date_encountered: D(-30) })).body;
  assert.equal(m.review_count, 0); // reviews dated before the new date are ignored for scheduling
  assert.equal(m.status, 'new');
  assert.equal(m.next_review, D(-29));

  assert.equal((await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'wow' })).status, 400);
  assert.equal((await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'independent', date: D(-400) })).status, 400);

  const fresh = (await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: cause })).body;
  assert.equal(fresh.next_review, D(1));
  await call('PUT', '/api/settings/srs', { value: { intervals: [2, 4, 8] } });
  assert.equal((await boots({ call })).mistakes.find((x) => x.id === fresh.id).next_review, D(2));
  assert.equal((await call('PUT', '/api/settings/srs', { value: { intervals: [] } })).status, 400);
  await app.close();
});

test('tests link to mistakes; deleting a test keeps the mistakes', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const sub = b.subjects[0];
  const cause = b.causes[0].id;
  const r = await call('POST', '/api/tests', {
    name: 'Mock 3', provider: 'ProviderA', date: D(-2), type: 'mock', total_questions: 65, total_marks: 100,
    marks_obtained: 41.67, correct: 30, incorrect: 20, negative_marks: 8, breakdown: [{ subject_id: sub.id, correct: 10, incorrect: 5 }],
  });
  assert.equal(r.status, 200);
  const tid = r.body.id;
  assert.equal(r.body.user_id, undefined);
  assert.equal((await call('POST', '/api/tests', { name: 'bad', date: D(0), total_questions: 10, correct: 8, incorrect: 5 })).status, 400);
  assert.equal((await call('POST', '/api/tests', { name: 'bad', date: 'yesterday' })).status, 400);

  const m1 = (await call('POST', '/api/mistakes', { subject_id: sub.id, cause_primary: cause, test_id: tid })).body;
  await call('POST', '/api/mistakes', { subject_id: sub.id, cause_primary: b.causes[1].id, test_id: tid, question_no: '12' });
  assert.equal(m1.test_name, 'Mock 3'); // copied from the test, no retyping
  assert.equal(m1.provider, 'ProviderA');
  assert.equal((await boots({ call })).mistakes.filter((m) => m.test_id === tid).length, 2);

  await call('DELETE', `/api/tests/${tid}`);
  const state = await boots({ call });
  assert.equal(state.mistakes.length, 2);
  assert.equal(state.mistakes[0].test_id, null);
  assert.equal(state.mistakes[0].test_name, 'Mock 3');
  await app.close();
});

test('bulk operations', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: b.causes[0].id, question_text: `q${i}` })).body.id);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'add_tag', value: 'revisit' })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'set_cause', value: b.causes[3].id })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [ids[0]], action: 'archive' })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'nonsense' })).status, 400);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [], action: 'archive' })).status, 400);
  const s = await boots({ call });
  assert.ok(s.mistakes.every((m) => m.tags.includes('revisit') && m.cause_primary === b.causes[3].id));
  assert.equal(s.mistakes.filter((m) => m.archived).length, 1);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [ids[1], ids[2]], action: 'delete' })).body.count, 2);
  assert.equal((await boots({ call })).mistakes.length, 1);
  await app.close();
});

test('schedule tracker: tasks (with weekly repeat), study log, syllabus progress', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const t = (await call('POST', '/api/tasks', { date: D(0), title: 'Revise thermo', subject_id: b.subjects[5].id, kind: 'revision', minutes: 60, repeat_weeks: 2 })).body;
  let s = await boots({ call });
  assert.deepEqual(s.tasks.map((x) => x.date), [D(0), D(7), D(14)]);
  const done = (await call('PUT', `/api/tasks/${t.id}`, { done: true })).body;
  assert.equal(done.done, 1);
  assert.ok(done.done_at);
  assert.equal((await call('POST', '/api/tasks', { date: D(0), title: '' })).status, 400);
  assert.equal((await call('POST', '/api/log', { date: D(0), minutes: 90, subject_id: b.subjects[0].id, activity: 'study' })).status, 200);
  assert.equal((await call('POST', '/api/log', { date: D(0), minutes: 0 })).status, 400);
  await call('PUT', `/api/progress/${b.topics[0].id}`, { studied: true, revision_count: 2 });
  await call('PUT', `/api/progress/${b.topics[0].id}`, { pyq_done: true });
  s = await boots({ call });
  assert.equal(s.studyLog.length, 1);
  assert.deepEqual([s.progress[0].studied, s.progress[0].revision_count, s.progress[0].pyq_done], [1, 2, 1]);
  await app.close();
});

test('settings: syllabus and cause editing guard referenced records', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const sub = (await call('POST', '/api/subjects', { name: 'Extra' })).body;
  assert.equal((await call('POST', '/api/subjects', { name: 'Extra' })).status, 400); // duplicate within the branch
  const top = (await call('POST', '/api/topics', { subject_id: sub.id, name: 'T1' })).body;
  const subtop = (await call('POST', '/api/topics', { subject_id: sub.id, parent_id: top.id, name: 'sub' })).body;
  assert.equal((await call('POST', '/api/topics', { subject_id: sub.id, parent_id: subtop.id, name: 'too deep' })).status, 400);
  await call('POST', '/api/mistakes', { subject_id: sub.id, topic_id: top.id, subtopic_id: subtop.id, cause_primary: b.causes[0].id });
  assert.equal((await call('DELETE', `/api/subjects/${sub.id}`)).status, 400);
  assert.equal((await call('DELETE', `/api/causes/${b.causes[0].id}`)).status, 400);
  assert.equal((await call('DELETE', `/api/topics/${top.id}`)).status, 200);
  assert.equal((await boots({ call })).mistakes[0].topic_id, null); // the mistake survives
  await app.close();
});

test('branches: pick one at sign-up, add the other later; data is separate per branch', async () => {
  const { app, call, useStream } = await boot(tmp());
  const me = (await call('GET', '/api/streams')).body.streams[0];
  assert.equal(me.code, 'ME');

  useStream(null); // no branch chosen yet -> the API only offers the picker data
  const first = await boots({ call });
  assert.equal(first.needsStream, true);
  assert.equal(first.mistakes, undefined);
  assert.equal((await call('POST', '/api/tests', { name: 'x', date: D(0) })).status, 400);
  assert.equal((await call('POST', '/api/tasks', { title: 't', date: D(0) })).status, 400);

  useStream(me.id);
  const b = await boots({ call });
  await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: b.causes[0].id });
  await call('POST', '/api/tests', { name: 'ME mock', date: D(0) });
  await call('POST', '/api/tasks', { title: 'ME task', date: D(0) });
  await call('POST', '/api/log', { date: D(0), minutes: 30 });

  assert.equal((await call('POST', '/api/streams', { code: 'XX' })).status, 400); // unknown branch
  assert.equal((await call('POST', '/api/streams', { code: 'ME' })).status, 400); // already have it
  const da = (await call('POST', '/api/streams', { code: 'DA' })).body;
  assert.equal(da.code, 'DA');
  assert.equal((await call('POST', '/api/streams', { code: 'DA' })).status, 400);
  assert.deepEqual((await call('GET', '/api/streams')).body.available, []);

  useStream(da.id);
  const daData = await boots({ call });
  assert.ok(daData.subjects.some((x) => x.name === 'Machine Learning'));
  assert.ok(daData.topics.length > 90);
  assert.deepEqual([daData.mistakes.length, daData.tests.length, daData.tasks.length, daData.studyLog.length], [0, 0, 0, 0]);
  await call('POST', '/api/tests', { name: 'DA mock', date: D(0) });
  assert.deepEqual((await boots({ call })).tests.map((t) => t.name), ['DA mock']);

  useStream(me.id);
  const mine = await boots({ call });
  assert.deepEqual(mine.tests.map((t) => t.name), ['ME mock']);
  assert.equal(mine.mistakes.length, 1);
  assert.equal(mine.causes.length, 12); // root causes are shared across the user's branches
  await app.close();
});

test('accounts: sign-up validation, duplicate email, wrong password, sessions last a year and survive restarts', async () => {
  const dir = tmp();
  const { app, makeClient } = await boot(dir, { noUser: true });
  const c = makeClient();
  assert.deepEqual((await c.call('GET', '/api/session')).body.loggedIn, false);
  assert.equal((await c.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await c.call('POST', '/api/mistakes', { subject_id: 1, cause_primary: 1 })).status, 401);

  assert.equal((await c.signup('not-an-email', 'ME')).status, 400);
  assert.equal((await c.call('POST', '/api/signup', { email: 'x@y.com', password: 'short', branch: 'ME' })).status, 400);
  assert.equal((await c.call('POST', '/api/signup', { email: 'x@y.com', password: PW, branch: 'CE' })).status, 400); // must pick DA or ME
  assert.equal((await c.call('POST', '/api/signup', { email: 'x@y.com', password: PW })).status, 400);

  const ok = await c.signup('Me@Example.com', 'DA'); // email is case-insensitive
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  assert.match(ok.setCookie, /Max-Age=31536000/);
  assert.equal((await c.call('GET', '/api/bootstrap')).body.stream.code, 'DA');
  assert.equal((await c.call('GET', '/api/session')).body.user.email, 'me@example.com');

  const dup = makeClient();
  assert.equal((await dup.signup('me@example.com', 'ME')).status, 400);
  assert.equal((await dup.login('me@example.com', 'wrong-password')).status, 401);
  assert.equal((await dup.login('nobody@example.com')).status, 401);
  assert.equal((await dup.call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await dup.login('ME@example.com')).status, 200);

  // a forged / tampered cookie is rejected
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/bootstrap`, { headers: { Cookie: 'gate_session=1.9999999999.AAAA' } })).status, 401);

  const cookie = c.getCookie();
  await app.close();

  // restart: the signed cookie is stateless, so you are still signed in; a different secret signs everyone out
  const again = await boot(dir, { noUser: true });
  assert.equal((await fetch(`${again.base}/api/bootstrap`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${again.base}/api/bootstrap`, { headers: { Cookie: cookie.replace(/.$/, 'x') } })).status, 401);
  await again.app.close();

  const db = await pgliteAdapter(path.join(dir, 'pg'));
  const rotated = await createApp({ db, secret: 'a-different-secret' });
  await new Promise((r) => rotated.server.listen(0, '127.0.0.1', r));
  assert.equal((await fetch(`http://127.0.0.1:${rotated.server.address().port}/api/bootstrap`, { headers: { Cookie: cookie } })).status, 401);
  await rotated.close();

  // logout clears the cookie
  const out = await boot(tmp());
  await out.call('POST', '/api/logout');
  assert.equal(out.getCookie(), '');
  assert.equal((await out.call('GET', '/api/bootstrap')).status, 401);
  await out.app.close();
});

test('invite code: when set, sign-up needs it (sign-in does not)', async () => {
  const { app, makeClient } = await boot(tmp(), { inviteCode: 'friends-only', noUser: true });
  const c = makeClient();
  assert.equal((await c.call('GET', '/api/session')).body.inviteRequired, true);
  assert.equal((await c.signup('a@x.com', 'ME')).status, 403);
  assert.equal((await c.signup('a@x.com', 'ME', { invite: 'nope' })).status, 403);
  assert.equal((await c.signup('a@x.com', 'ME', { invite: 'friends-only' })).status, 200);
  const again = makeClient();
  assert.equal((await again.login('a@x.com')).status, 200);
  await app.close();
});

test('SEPARATION: one user can never see or touch another user’s data', async () => {
  const { app, base, a, makeClient } = await boot(tmp()); // A = ME
  const bClient = makeClient();
  assert.equal((await bClient.signup('b@example.com', 'ME')).status, 200); // B is also ME, so even identical syllabi stay separate
  const cClient = makeClient();
  assert.equal((await cClient.signup('c@example.com', 'DA')).status, 200);

  // A creates one of everything
  const A = await boots(a);
  const sub = A.subjects[0], top = A.topics.find((t) => t.subject_id === sub.id), cause = A.causes[0];
  const test1 = (await a.call('POST', '/api/tests', { name: 'A mock', date: D(0), breakdown: [{ subject_id: sub.id, correct: 1, incorrect: 1 }] })).body;
  const task = (await a.call('POST', '/api/tasks', { title: 'A task', date: D(0) })).body;
  const log = (await a.call('POST', '/api/log', { date: D(0), minutes: 20 })).body;
  const att = (await a.call('POST', '/api/attachments', { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' })).body.file;
  const mistake = (await a.call('POST', '/api/mistakes', { subject_id: sub.id, topic_id: top.id, cause_primary: cause.id, question_text: 'A secret question', test_id: test1.id, attachment: att })).body;
  await a.call('POST', `/api/mistakes/${mistake.id}/reviews`, { outcome: 'independent', date: D(1) });
  const review = (await boots(a)).reviews[0];
  await a.call('PUT', '/api/settings/general', { value: { examDate: '2027-02-01', dailyTargetMin: 300 } });
  await a.call('PUT', `/api/progress/${top.id}`, { studied: true });

  // B sees none of it, and has their own, differently-numbered syllabus and causes
  const B = await boots(bClient);
  assert.deepEqual([B.mistakes.length, B.tests.length, B.tasks.length, B.studyLog.length, B.reviews.length, B.progress.length], [0, 0, 0, 0, 0, 0]);
  assert.equal(B.settings.general.examDate, '');
  assert.equal(B.subjects.length, 24);
  assert.ok(B.subjects.every((s) => !A.subjects.some((x) => x.id === s.id)));
  assert.ok(B.causes.every((c) => !A.causes.some((x) => x.id === c.id)));
  assert.ok(!JSON.stringify(B).includes('A secret question'));

  // every by-id route, aimed at A's ids by B (and by C, a different branch), is refused
  for (const who of [bClient, cClient]) {
    const t = async (method, url, body, ...ok) => assert.ok(ok.includes((await who.call(method, url, body)).status), `${who === bClient ? 'B' : 'C'} ${method} ${url} should be refused`);
    await t('PUT', `/api/mistakes/${mistake.id}`, { question_text: 'hacked' }, 404);
    await t('DELETE', `/api/mistakes/${mistake.id}`, undefined, 404);
    await t('POST', `/api/mistakes/${mistake.id}/duplicate`, { date: D(0) }, 404);
    await t('POST', `/api/mistakes/${mistake.id}/reviews`, { outcome: 'failed', date: D(2) }, 404);
    await t('PUT', `/api/reviews/${review.id}`, { outcome: 'failed' }, 404);
    await t('DELETE', `/api/reviews/${review.id}`, undefined, 404);
    await t('POST', '/api/mistakes/bulk', { ids: [mistake.id], action: 'delete' }, 200); // deletes nothing of A's
    await t('POST', '/api/mistakes/bulk', { ids: [mistake.id], action: 'archive' }, 404);
    await t('PUT', `/api/tests/${test1.id}`, { name: 'hacked' }, 404);
    await t('DELETE', `/api/tests/${test1.id}`, undefined, 404);
    await t('PUT', `/api/tasks/${task.id}`, { done: true }, 404);
    await t('DELETE', `/api/tasks/${task.id}`, undefined, 404);
    await t('DELETE', `/api/log/${log.id}`, undefined, 404);
    await t('PUT', `/api/progress/${top.id}`, { studied: false }, 404);
    await t('PUT', `/api/subjects/${sub.id}`, { name: 'hacked' }, 404);
    await t('DELETE', `/api/subjects/${sub.id}`, undefined, 404);
    await t('PUT', `/api/topics/${top.id}`, { name: 'hacked' }, 404);
    await t('DELETE', `/api/topics/${top.id}`, undefined, 404);
    await t('PUT', `/api/causes/${cause.id}`, { name: 'hacked' }, 404);
    await t('DELETE', `/api/causes/${cause.id}`, undefined, 404);
  }
  // …and none of that changed anything
  const A2 = await boots(a);
  assert.equal(A2.mistakes.length, 1);
  assert.equal(A2.mistakes[0].question_text, 'A secret question');
  assert.notEqual(A2.mistakes[0].status, 'reopened');
  assert.equal(A2.reviews.length, 1);
  assert.deepEqual([A2.tests[0].name, A2.tasks[0].done, A2.studyLog.length, A2.progress[0].studied], ['A mock', 0, 1, 1]);
  assert.equal(A2.subjects.find((s) => s.id === sub.id).name, sub.name);
  assert.equal(A2.causes.find((c) => c.id === cause.id).name, cause.name);

  // B cannot point their own records at A's rows
  const bb = await boots(bClient);
  const bSub = bb.subjects[0], bCause = bb.causes[0];
  for (const body of [
    { subject_id: sub.id, cause_primary: bCause.id }, // A's subject
    { subject_id: bSub.id, cause_primary: cause.id }, // A's cause
    { subject_id: bSub.id, cause_primary: bCause.id, causes_secondary: [cause.id] },
    { subject_id: bSub.id, cause_primary: bCause.id, test_id: test1.id }, // A's test
    { subject_id: bSub.id, cause_primary: bCause.id, attachment: att }, // A's screenshot
    { subject_id: bSub.id, topic_id: top.id, cause_primary: bCause.id }, // A's topic
  ]) assert.equal((await bClient.call('POST', '/api/mistakes', body)).status, 400, JSON.stringify(body));
  assert.equal((await bClient.call('POST', '/api/tests', { name: 'x', date: D(0), breakdown: [{ subject_id: sub.id, correct: 1 }] })).status, 400);
  assert.equal((await bClient.call('POST', '/api/tasks', { title: 'x', date: D(0), subject_id: sub.id })).status, 400);
  assert.equal((await bClient.call('POST', '/api/log', { date: D(0), minutes: 5, subject_id: sub.id })).status, 400);
  assert.equal((await bClient.call('POST', '/api/topics', { subject_id: sub.id, name: 'x' })).status, 400);

  // B sending A's stream id gets the picker, not A's data
  bClient.useStream(A.stream.id);
  const spoof = await boots(bClient);
  assert.equal(spoof.needsStream, true);
  assert.equal(spoof.mistakes, undefined);
  assert.equal((await bClient.call('POST', '/api/tests', { name: 'x', date: D(0) })).status, 400);
  assert.equal((await bClient.call('POST', '/api/subjects', { name: 'Injected' })).status, 400);

  // screenshots are private to their owner
  assert.equal((await fetch(`${base}/api/attachments/${att}`, { headers: { Cookie: bClient.getCookie() } })).status, 404);
  assert.equal((await fetch(`${base}/api/attachments/${att}`, { headers: { Cookie: a.getCookie() } })).status, 200);
  assert.equal((await fetch(`${base}/api/attachments/${att}`)).status, 401);

  // B's changes to their own account don't leak back either
  bClient.useStream(bb.stream.id);
  await bClient.call('PUT', '/api/settings/general', { value: { examDate: '2030-01-01' } });
  await bClient.call('POST', '/api/mistakes', { subject_id: bSub.id, cause_primary: bCause.id, question_text: 'B question' });
  const A3 = await boots(a);
  assert.equal(A3.settings.general.examDate, '2027-02-01');
  assert.deepEqual(A3.mistakes.map((m) => m.question_text), ['A secret question']);
  await app.close();
});

test('persistence: data survives an application restart; schema is migrated, not recreated', async () => {
  const dir = tmp();
  const { app, a, call } = await boot(dir);
  const b = await boots(a);
  const m = (await call('POST', '/api/mistakes', { subject_id: b.subjects[1].id, cause_primary: b.causes[2].id, question_text: 'persist me', tags: ['x'] })).body;
  await call('POST', `/api/mistakes/${m.id}/reviews`, { outcome: 'independent', date: D(1) });
  await call('POST', '/api/tests', { name: 'T', date: D(0) });
  await call('POST', '/api/tasks', { title: 'task', date: D(0) });
  await call('PUT', '/api/settings/general', { value: { examDate: '2027-02-07', dailyTargetMin: 300 } });
  await app.close();

  const again = await boot(dir, { noUser: true }); // "restart"
  const c = again.makeClient();
  assert.equal((await c.login('a@example.com')).status, 200); // the account survived too
  const s = await boots(c);
  assert.equal(s.subjects.length, 24); // not re-seeded
  assert.equal(s.mistakes.length, 1);
  assert.equal(s.mistakes[0].question_text, 'persist me');
  assert.equal(s.mistakes[0].review_count, 1);
  assert.equal(s.reviews.length, 1);
  assert.equal(s.tests.length, 1);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.settings.general.examDate, '2027-02-07');
  assert.equal((await again.app.store.forUser(s.user.id).getSettings()).general.dailyTargetMin, 300);
  await again.app.close();
});

test('attachments (stored in the database): only images, served back; static serving blocks path traversal; cross-origin refused', async () => {
  const { app, call, base, getCookie } = await boot(tmp());
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = await call('POST', '/api/attachments', { data: png });
  assert.equal(r.status, 200);
  const img = await fetch(`${base}/api/attachments/${r.body.file}`, { headers: { Cookie: getCookie() } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call('POST', '/api/attachments', { data: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await fetch(`${base}/api/attachments/..%2F..%2Fpackage.json`, { headers: { Cookie: getCookie() } })).status, 404);
  assert.equal((await fetch(`${base}/shared/..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/bootstrap`, { headers: { Origin: 'http://evil.example', Cookie: getCookie() } })).status, 403);
  assert.equal((await fetch(base + '/')).status, 200);
  await app.close();
});

test('demo data: loads on both branches, is idempotent, and removal keeps your own entries and other users untouched', async () => {
  const { app, a, call, makeClient } = await boot(tmp()); // A = ME
  const other = makeClient();
  await other.signup('other@example.com', 'ME');
  const otherBefore = await boots(other);
  const b = await boots(a);

  // an entry of A's own, made before loading the demo
  const own = (await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: b.causes[0].id, question_text: 'my real question', tags: ['mine'] })).body;
  await call('POST', '/api/tests', { name: 'My real mock', date: D(-1) });
  await call('POST', '/api/tasks', { title: 'My real task', date: D(0) });

  let r = await call('POST', '/api/demo', { today: D(0) });
  assert.equal(r.status, 200);
  assert.equal(r.body.already, false);
  assert.equal(r.body.mistakes, 19);
  let s = await boots(a);
  assert.equal(s.mistakes.length, 20); // 19 sample + 1 of A's own
  assert.equal(s.mistakes.filter((m) => m.tags.includes('sample')).length, 19);
  assert.ok(s.tests.some((t) => t.name.startsWith('[Sample]')));
  assert.ok(s.tasks.some((t) => t.title.startsWith('[Sample]')));
  assert.ok(s.studyLog.length > 15);
  assert.ok(s.progress.length > 20);
  const statuses = new Set(s.mistakes.map((m) => m.status));
  assert.ok(statuses.size >= 3, `varied review states, got ${[...statuses]}`); // new / in progress / improving / mastered / reopened …
  assert.ok(s.reviews.length > 10);
  assert.ok(s.mistakes.some((m) => m.next_review < D(0) && m.status !== 'mastered')); // some overdue so the queue has content

  // loading again changes nothing
  r = await call('POST', '/api/demo', { today: D(0) });
  assert.equal(r.body.already, true);
  assert.equal((await boots(a)).mistakes.length, 20);

  // another user never sees it
  const otherAfter = await boots(other);
  assert.deepEqual([otherAfter.mistakes.length, otherAfter.tests.length, otherAfter.tasks.length, otherAfter.studyLog.length], [0, 0, 0, 0]);
  assert.equal(JSON.stringify(otherAfter.subjects), JSON.stringify(otherBefore.subjects));

  // remove: only the demo goes
  r = await call('DELETE', '/api/demo');
  assert.equal(r.status, 200);
  assert.equal(r.body.mistakes, 19);
  s = await boots(a);
  assert.deepEqual(s.mistakes.map((m) => m.question_text), ['my real question']);
  assert.equal(s.mistakes[0].id, own.id);
  assert.deepEqual(s.tests.map((t) => t.name), ['My real mock']);
  assert.deepEqual(s.tasks.map((t) => t.title), ['My real task']);
  assert.deepEqual([s.studyLog.length, s.progress.filter((p) => p.studied).length, s.reviews.length], [0, 0, 0]);
  // removing when nothing is loaded is harmless, and it can be loaded again
  assert.equal((await call('DELETE', '/api/demo')).body.mistakes, 0);
  assert.equal((await call('POST', '/api/demo', { today: D(0) })).body.already, false);
  await call('DELETE', '/api/demo');

  // the DA branch has its own demo set
  const da = (await call('POST', '/api/streams', { code: 'DA' })).body;
  a.useStream(da.id);
  r = await call('POST', '/api/demo', { today: D(0) });
  assert.equal(r.status, 200);
  assert.ok(r.body.mistakes >= 20);
  const daState = await boots(a);
  assert.ok(daState.mistakes.some((m) => /SVM|Bayes|Dijkstra/.test(m.question_text)));
  a.useStream(me0(b));
  assert.deepEqual((await boots(a)).mistakes.map((m) => m.question_text), ['my real question']); // ME untouched by DA demo
  assert.equal((await call('DELETE', '/api/demo')).body.mistakes, r.body.mistakes); // remove finds it in the other branch too
  await app.close();
});
function me0(b) {
  return b.stream.id;
}

test('demo data requires being signed in', async () => {
  const { app, makeClient } = await boot(tmp(), { noUser: true });
  const c = makeClient();
  assert.equal((await c.call('POST', '/api/demo', { today: D(0) })).status, 401);
  assert.equal((await c.call('DELETE', '/api/demo')).status, 401);
  await app.close();
});

test('a valid session cookie for an account that no longer exists is treated as signed out', async () => {
  const one = await boot(tmp());
  const cookie = one.getCookie();
  await one.app.close();
  const wiped = await boot(tmp(), { noUser: true }); // a brand-new database; same signing secret
  const r = await fetch(`${wiped.base}/api/bootstrap`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'login');
  assert.equal((await (await fetch(`${wiped.base}/api/session`, { headers: { Cookie: cookie } })).json()).loggedIn, false);
  await wiped.app.close();
});

test('regressions: partial test edits, subject change clears topic, cause delete guard, review date, done_at, bulk count, general setting', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const [s1, s2] = b.subjects;
  const topic = b.topics.find((t) => t.subject_id === s1.id && !t.parent_id);
  const [c1, c2] = b.causes;
  // partial test update is checked against the stored record
  const t = (await call('POST', '/api/tests', { name: 'T', date: D(-1), total_questions: 10, correct: 5, incorrect: 3 })).body;
  assert.equal((await call('PUT', `/api/tests/${t.id}`, { total_questions: 6 })).status, 400);
  assert.equal((await call('PUT', `/api/tests/${t.id}`, { correct: 8 })).status, 400);
  assert.equal((await call('PUT', `/api/tests/${t.id}`, { correct: 6 })).status, 200);
  // moving to another subject drops the old topic
  const m = (await call('POST', '/api/mistakes', { subject_id: s1.id, topic_id: topic.id, cause_primary: c1.id, causes_secondary: [c2.id], date_encountered: D(-3) })).body;
  const moved = (await call('PUT', `/api/mistakes/${m.id}`, { subject_id: s2.id })).body;
  assert.equal(moved.topic_id, null);
  // a cause used only as a contributing cause cannot be deleted
  assert.equal((await call('DELETE', `/api/causes/${c2.id}`)).status, 400);
  // review cannot be edited to before the mistake
  const withReview = (await call('POST', `/api/mistakes/${m.id}/reviews`, { outcome: 'independent', date: D(-1) })).body;
  void withReview;
  const rid = (await boots({ call })).reviews[0].id;
  assert.equal((await call('PUT', `/api/reviews/${rid}`, { date: D(-10) })).status, 400);
  // tasks created as done get done_at
  const task = (await call('POST', '/api/tasks', { title: 'x', date: D(0), done: true })).body;
  assert.ok(task.done_at);
  // bulk delete reports real deletions
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [m.id, 999999], action: 'delete' })).body.count, 1);
  // general setting must be an object
  assert.equal((await call('PUT', '/api/settings/general', { value: null })).status, 400);
  await app.close();
});

test('regressions 2: breakdown scrub, topic importance inherits, bulk next-review, X-Today, attachment prune, many-mistake recompute', async () => {
  const { app, call } = await boot(tmp());
  const b = await boots({ call });
  const [s1, s2] = b.subjects;
  const topic = b.topics.find((x) => x.subject_id === s1.id && !x.parent_id);
  assert.equal(topic.importance, null); // seeded topics inherit their subject's importance
  assert.equal((await call('PUT', `/api/topics/${topic.id}`, { importance: 3 })).body.importance, 3); // an explicit 3 is allowed
  const cause = b.causes[0].id;
  // breakdown rows disappear with the subject / topic they point at
  const t = (await call('POST', '/api/tests', { name: 'T', date: D(-1), breakdown: [{ subject_id: s1.id, correct: 1 }, { subject_id: s2.id, topic_id: b.topics.find((x) => x.subject_id === s2.id).id, correct: 2 }] })).body;
  assert.equal((await call('DELETE', `/api/subjects/${s1.id}`)).status, 200);
  assert.deepEqual((await boots({ call })).tests.find((x) => x.id === t.id).breakdown.map((r) => r.subject_id), [s2.id]);
  // X-Today decides default dates
  const m = (await call('POST', '/api/mistakes', { subject_id: s2.id, cause_primary: cause }, { 'X-Today': D(-5) })).body;
  assert.equal(m.date_encountered, D(-5));
  // bulk: set-based update + recompute for a manual next-review date
  const ids = [m.id];
  for (let i = 0; i < 5; i++) ids.push((await call('POST', '/api/mistakes', { subject_id: s2.id, cause_primary: cause, date_encountered: D(-2) })).body.id);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'set_next_review', value: D(30) })).body.count, 6);
  assert.ok((await boots({ call })).mistakes.every((x) => x.next_review === D(30)));
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'set_severity', value: 4 })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'set_cause' })).status, 400);
  // changing the schedule settings re-derives every mistake in one pass
  assert.equal((await call('PUT', '/api/settings/srs', { value: { intervals: [2, 4], failInterval: 1, masteryStreak: 3, maintenanceDays: 30 } })).status, 200);
  assert.ok((await boots({ call })).mistakes.every((x) => x.next_review === D(30))); // overrides survive
  await app.close();
});

