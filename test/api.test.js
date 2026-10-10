import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { pgliteAdapter } from '../src/db.js';
import { addDays, todayStr } from '../public/shared/dates.js';

async function boot(dir, password = '') {
  const db = await pgliteAdapter(path.join(dir, 'pg'));
  const app = await createApp({ db, password });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  let stream = null; // the stream the UI would have chosen (sent as X-Stream)
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(stream ? { 'X-Stream': String(stream) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: res.status, body: await res.json(), setCookie: sc };
  };
  const useStream = (id) => (stream = id);
  if (!password) stream = (await call('GET', '/api/streams')).body.find((x) => x.code === 'ME').id; // like the app: choose a stream (ME has the richest syllabus)
  return { app, call, base, getCookie: () => cookie, useStream };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
const D = (n) => addDays(todayStr(), n);

test('fresh database: syllabus seeded, mistakes empty, empty-state safe', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const { body } = await call('GET', '/api/bootstrap');
  assert.equal(body.stream.code, 'ME');
  assert.deepEqual(body.streams.map((x) => x.code), ['DA', 'ME']);
  assert.equal(body.subjects.length, 24);
  assert.ok(body.subjects.some((s) => s.name === 'Thermodynamics' && s.section === 'Fluid Mechanics and Thermal Sciences'));
  assert.ok(body.topics.length > 150);
  assert.equal(body.causes.length, 12);
  assert.equal(body.mistakes.length, 0);
  assert.equal(body.tests.length, 0);
  assert.deepEqual(body.settings.srs.intervals, [1, 3, 7, 14, 30]);
  await app.close();
});

test('create / edit / duplicate / archive / delete a mistake with validation', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const boot0 = (await call('GET', '/api/bootstrap')).body;
  const ml = boot0.subjects.find((s) => s.name === 'Thermodynamics');
  const topic = boot0.topics.find((t) => t.subject_id === ml.id);

  // quick-add: only subject + primary cause
  let r = await call('POST', '/api/mistakes', { subject_id: ml.id, cause_primary: boot0.causes[0].id });
  assert.equal(r.status, 200);
  const id = r.body.id;
  assert.equal(r.body.status, 'new');
  assert.equal(r.body.next_review, D(1));

  // validation errors are clear
  r = await call('POST', '/api/mistakes', { subject_id: ml.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /cause_primary/);
  r = await call('POST', '/api/mistakes', { subject_id: ml.id, cause_primary: 1, confidence: 9 });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/mistakes', { subject_id: 9999, cause_primary: 1 });
  assert.equal(r.status, 400);
  // topic must belong to subject
  const other = boot0.topics.find((t) => t.subject_id !== ml.id);
  r = await call('POST', '/api/mistakes', { subject_id: ml.id, topic_id: other.id, cause_primary: 1 });
  assert.equal(r.status, 400);

  r = await call('PUT', `/api/mistakes/${id}`, { topic_id: topic.id, marks_lost: 2, tags: ['svm', 'kernel'], question_text: 'Why does the margin shrink?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.marks_lost, 2);
  assert.deepEqual(r.body.tags, ['svm', 'kernel']);

  r = await call('POST', `/api/mistakes/${id}/duplicate`);
  assert.notEqual(r.body.id, id);
  assert.equal(r.body.question_text, 'Why does the margin shrink?');

  r = await call('PUT', `/api/mistakes/${id}`, { archived: true });
  assert.equal(r.body.archived, true);
  r = await call('DELETE', `/api/mistakes/${id}`);
  assert.equal(r.status, 200);
  assert.equal((await call('DELETE', `/api/mistakes/${id}`)).status, 404);
  await app.close();
});

test('review workflow: next date, mastery needs repeats, failure reopens, undo re-derives', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const b = (await call('GET', '/api/bootstrap')).body;
  const created = (await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: 1, date_encountered: D(-60) })).body;
  const id = created.id;
  assert.equal(created.next_review, D(-59));

  const dates = [D(-59), D(-56), D(-49), D(-35)];
  let m;
  for (const d of dates) m = (await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'independent', date: d })).body;
  assert.equal(m.status, 'mastered');

  // failing after mastery reopens it and shortens the interval
  m = (await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'failed', date: D(-1) })).body;
  assert.equal(m.status, 'reopened');
  assert.equal(m.next_review, D(0));
  assert.equal(m.reopen_count, 1);

  // undoing that review restores mastery (state is re-derived, not patched)
  const rid = (await call('GET', '/api/bootstrap')).body.reviews.find((r) => r.outcome === 'failed').id;
  m = (await call('DELETE', `/api/reviews/${rid}`)).body;
  assert.equal(m.status, 'mastered');

  // editing the original date re-derives the schedule
  m = (await call('PUT', `/api/mistakes/${id}`, { date_encountered: D(-30) })).body;
  assert.equal(m.review_count, 0); // reviews dated before the new date are ignored for scheduling
  assert.equal(m.status, 'new');
  assert.equal(m.next_review, D(-29));

  // invalid review input
  assert.equal((await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'wow' })).status, 400);
  assert.equal((await call('POST', `/api/mistakes/${id}/reviews`, { outcome: 'independent', date: D(-400) })).status, 400);

  // changing interval settings recomputes every mistake
  const fresh = (await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: 1 })).body;
  assert.equal(fresh.next_review, D(1));
  await call('PUT', '/api/settings/srs', { value: { intervals: [2, 4, 8] } });
  const after = (await call('GET', `/api/bootstrap`)).body.mistakes.find((x) => x.id === fresh.id);
  assert.equal(after.next_review, D(2));
  assert.equal((await call('PUT', '/api/settings/srs', { value: { intervals: [] } })).status, 400);
  await app.close();
});

test('tests link to mistakes; analytics inputs update after edits and deletions', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const b = (await call('GET', '/api/bootstrap')).body;
  const sub = b.subjects[0];
  let r = await call('POST', '/api/tests', {
    name: 'Mock 3', provider: 'ProviderA', date: D(-2), type: 'mock', total_questions: 65, total_marks: 100,
    marks_obtained: 41.67, correct: 30, incorrect: 20, negative_marks: 8, breakdown: [{ subject_id: sub.id, correct: 10, incorrect: 5 }],
  });
  assert.equal(r.status, 200);
  const tid = r.body.id;
  assert.equal((await call('POST', '/api/tests', { name: 'bad', date: D(0), total_questions: 10, correct: 8, incorrect: 5 })).status, 400);
  assert.equal((await call('POST', '/api/tests', { name: 'bad', date: 'yesterday' })).status, 400);

  const m1 = (await call('POST', '/api/mistakes', { subject_id: sub.id, cause_primary: 1, test_id: tid })).body;
  await call('POST', '/api/mistakes', { subject_id: sub.id, cause_primary: 2, test_id: tid, question_no: '12' });
  assert.equal(m1.test_name, 'Mock 3'); // copied from the test, no retyping
  assert.equal(m1.provider, 'ProviderA');
  let state = (await call('GET', '/api/bootstrap')).body;
  assert.equal(state.mistakes.filter((m) => m.test_id === tid).length, 2);

  // deleting the test keeps the mistakes (they retain test_name) and unlinks them
  await call('DELETE', `/api/tests/${tid}`);
  state = (await call('GET', '/api/bootstrap')).body;
  assert.equal(state.mistakes.length, 2);
  assert.equal(state.mistakes[0].test_id, null);
  assert.equal(state.mistakes[0].test_name, 'Mock 3');
  await app.close();
});

test('bulk operations and search-relevant fields persist', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const b = (await call('GET', '/api/bootstrap')).body;
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: 1, question_text: `q${i}` })).body.id);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'add_tag', value: 'revisit' })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'set_cause', value: 4 })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [ids[0]], action: 'archive' })).status, 200);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids, action: 'nonsense' })).status, 400);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [], action: 'archive' })).status, 400);
  const s = (await call('GET', '/api/bootstrap')).body;
  assert.ok(s.mistakes.every((m) => m.tags.includes('revisit') && m.cause_primary === 4));
  assert.equal(s.mistakes.filter((m) => m.archived).length, 1);
  assert.equal((await call('POST', '/api/mistakes/bulk', { ids: [ids[1], ids[2]], action: 'delete' })).body.count, 2);
  assert.equal((await call('GET', '/api/bootstrap')).body.mistakes.length, 1);
  await app.close();
});

test('schedule tracker: tasks (with weekly repeat), study log, syllabus progress', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const b = (await call('GET', '/api/bootstrap')).body;
  const t = (await call('POST', '/api/tasks', { date: D(0), title: 'SVM revision', subject_id: b.subjects[5].id, kind: 'revision', minutes: 60, repeat_weeks: 2 })).body;
  let s = (await call('GET', '/api/bootstrap')).body;
  assert.equal(s.tasks.length, 3);
  assert.deepEqual(s.tasks.map((x) => x.date), [D(0), D(7), D(14)]);
  const done = (await call('PUT', `/api/tasks/${t.id}`, { done: true })).body;
  assert.equal(done.done, 1);
  assert.ok(done.done_at);
  assert.equal((await call('POST', '/api/tasks', { date: D(0), title: '' })).status, 400);
  assert.equal((await call('POST', '/api/log', { date: D(0), minutes: 90, subject_id: b.subjects[0].id, activity: 'study' })).status, 200);
  assert.equal((await call('POST', '/api/log', { date: D(0), minutes: 0 })).status, 400);
  await call('PUT', `/api/progress/${b.topics[0].id}`, { studied: true, revision_count: 2 });
  await call('PUT', `/api/progress/${b.topics[0].id}`, { pyq_done: true });
  s = (await call('GET', '/api/bootstrap')).body;
  assert.equal(s.studyLog.length, 1);
  assert.deepEqual([s.progress[0].studied, s.progress[0].revision_count, s.progress[0].pyq_done], [1, 2, 1]);
  await app.close();
});

test('settings: syllabus and cause editing guard referenced records', async () => {
  const dir = tmp();
  const { app, call } = await boot(dir);
  const b = (await call('GET', '/api/bootstrap')).body;
  const sub = (await call('POST', '/api/subjects', { name: 'Extra' })).body;
  assert.equal((await call('POST', '/api/subjects', { name: 'Extra' })).status, 400); // duplicate
  const top = (await call('POST', '/api/topics', { subject_id: sub.id, name: 'T1' })).body;
  const subtop = (await call('POST', '/api/topics', { subject_id: sub.id, parent_id: top.id, name: 'sub' })).body;
  assert.equal((await call('POST', '/api/topics', { subject_id: sub.id, parent_id: subtop.id, name: 'too deep' })).status, 400);
  await call('POST', '/api/mistakes', { subject_id: sub.id, topic_id: top.id, subtopic_id: subtop.id, cause_primary: b.causes[0].id });
  assert.equal((await call('DELETE', `/api/subjects/${sub.id}`)).status, 400);
  assert.equal((await call('DELETE', `/api/causes/${b.causes[0].id}`)).status, 400);
  assert.equal((await call('DELETE', `/api/topics/${top.id}`)).status, 200);
  const m = (await call('GET', '/api/bootstrap')).body.mistakes[0];
  assert.equal(m.topic_id, null); // the mistake survives
  await app.close();
});

test('persistence: data survives an application restart; schema is migrated, not recreated', async () => {
  const dir = tmp();
  let { app, call } = await boot(dir);
  const b = (await call('GET', '/api/bootstrap')).body;
  const m = (await call('POST', '/api/mistakes', { subject_id: b.subjects[1].id, cause_primary: 3, question_text: 'persist me', tags: ['x'] })).body;
  await call('POST', `/api/mistakes/${m.id}/reviews`, { outcome: 'independent', date: D(1) });
  await call('POST', '/api/tests', { name: 'T', date: D(0) });
  await call('POST', '/api/tasks', { date: D(0), title: 'task' });
  await call('PUT', '/api/settings/general', { value: { examDate: '2027-02-07', dailyTargetMin: 300 } });
  await app.close();

  ({ app, call } = await boot(dir)); // "restart"
  const s = (await call('GET', '/api/bootstrap')).body;
  assert.equal(s.subjects.length, 24); // not re-seeded
  assert.equal(s.mistakes.length, 1);
  assert.equal(s.mistakes[0].question_text, 'persist me');
  assert.equal(s.mistakes[0].review_count, 1);
  assert.equal(s.reviews.length, 1);
  assert.equal(s.tests.length, 1);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.settings.general.examDate, '2027-02-07');
  assert.equal((await app.store.getSettings()).general.dailyTargetMin, 300);
  await app.close();
});

test('attachments (stored in the database): only images, served back; static serving blocks path traversal; cross-origin refused', async () => {
  const dir = tmp();
  const { app, call, base } = await boot(dir);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = await call('POST', '/api/attachments', { data: png });
  assert.equal(r.status, 200);
  const img = await fetch(`${base}/api/attachments/${r.body.file}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call('POST', '/api/attachments', { data: 'data:text/html;base64,PGI+' })).status, 400);
  const trav = await fetch(`${base}/api/attachments/..%2F..%2Fpackage.json`);
  assert.equal(trav.status, 404);
  const trav2 = await fetch(`${base}/shared/..%2Fpackage.json`);
  assert.equal(trav2.status, 404);
  const cross = await fetch(`${base}/api/bootstrap`, { headers: { Origin: 'http://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal((await fetch(base + '/')).status, 200);
  await app.close();
});

test('login: protected API, wrong password refused, one session cookie lasts a year, logout works', async () => {
  const dir = tmp();
  const { app, call, getCookie } = await boot(dir, 's3cret-pass');
  assert.deepEqual((await call('GET', '/api/session')).body, { loggedIn: false, passwordRequired: true });
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await call('POST', '/api/mistakes', { subject_id: 1, cause_primary: 1 })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);

  const ok = await call('POST', '/api/login', { password: 's3cret-pass' });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  assert.match(ok.setCookie, /Max-Age=31536000/);
  assert.equal((await call('GET', '/api/bootstrap')).status, 200);
  assert.equal((await call('GET', '/api/session')).body.loggedIn, true);

  // a forged / tampered cookie is rejected
  const forged = await fetch(app.server.address() && `http://127.0.0.1:${app.server.address().port}/api/bootstrap`, { headers: { Cookie: 'gate_session=9999999999.AAAA' } });
  assert.equal(forged.status, 401);

  await call('POST', '/api/logout');
  assert.equal(getCookie(), '');
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);
  await app.close();
});

test('login: sessions survive a server restart (stateless signed cookie) but not a password change', async () => {
  const dir = tmp();
  let { app, call, getCookie } = await boot(dir, 'pw-one');
  await call('POST', '/api/login', { password: 'pw-one' });
  const cookie = getCookie();
  await app.close();

  const again = await boot(dir, 'pw-one');
  const r = await fetch(`${again.base}/api/bootstrap`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  await again.app.close();

  const changed = await boot(dir, 'pw-two');
  const r2 = await fetch(`${changed.base}/api/bootstrap`, { headers: { Cookie: cookie } });
  assert.equal(r2.status, 401);
  await changed.app.close();
});

test('streams: no stream chosen yet -> picker data only; data is scoped per stream; deleting guards data', async () => {
  const dir = tmp();
  const { app, call, useStream } = await boot(dir);
  const all = (await call('GET', '/api/streams')).body;
  const me = all.find((x) => x.code === 'ME');
  const da = all.find((x) => x.code === 'DA');
  assert.deepEqual([me.subjects, da.subjects], [24, 8]);

  // without a chosen stream the API only offers the list (what the picker needs)
  useStream(null);
  const first = (await call('GET', '/api/bootstrap')).body;
  assert.equal(first.needsStream, true);
  assert.equal(first.streams.length, 2);
  assert.equal(first.mistakes, undefined);
  assert.equal((await call('POST', '/api/tests', { name: 'x', date: D(0) })).status, 400); // can't create data without a stream
  assert.equal((await call('POST', '/api/tasks', { title: 't', date: D(0) })).status, 400);

  useStream(me.id);
  const b = (await call('GET', '/api/bootstrap')).body;
  await call('POST', '/api/mistakes', { subject_id: b.subjects[0].id, cause_primary: 1 });
  await call('POST', '/api/tests', { name: 'ME mock', date: D(0) });
  await call('POST', '/api/tasks', { title: 'ME task', date: D(0) });
  await call('POST', '/api/log', { date: D(0), minutes: 30 });

  // DA is its own stream with the DA syllabus, and sees none of the ME data
  useStream(da.id);
  const daData = (await call('GET', '/api/bootstrap')).body;
  assert.ok(daData.subjects.some((x) => x.name === 'Machine Learning'));
  assert.ok(daData.topics.length > 90);
  assert.deepEqual([daData.mistakes.length, daData.tests.length, daData.tasks.length, daData.studyLog.length], [0, 0, 0, 0]);
  useStream(me.id);

  // a third stream starts empty and sees none of the ME data
  const other = (await call('POST', '/api/streams', { name: 'Civil Engineering', code: 'ce' })).body;
  assert.equal(other.code, 'CE');
  assert.equal((await call('POST', '/api/streams', { name: 'Dup', code: 'CE' })).status, 400);
  assert.equal((await call('POST', '/api/streams', { name: 'Bad', code: 'no spaces' })).status, 400);
  useStream(other.id);
  const empty = (await call('GET', '/api/bootstrap')).body;
  assert.deepEqual([empty.subjects.length, empty.mistakes.length, empty.tests.length, empty.tasks.length, empty.studyLog.length], [0, 0, 0, 0, 0]);
  const sub = (await call('POST', '/api/subjects', { name: 'Structures', section: 'Core' })).body; // lands in the CE stream
  assert.equal((await call('GET', '/api/bootstrap')).body.subjects.map((x) => x.name).join(), 'Structures');
  await call('POST', '/api/tests', { name: 'CE mock', date: D(0) });
  assert.deepEqual((await call('GET', '/api/bootstrap')).body.tests.map((t) => t.name), ['CE mock']);

  // same subject name is allowed in different streams
  useStream(me.id);
  assert.equal((await call('POST', '/api/subjects', { name: 'Structures' })).status, 200);
  assert.equal((await call('POST', '/api/subjects', { name: 'Structures' })).status, 400); // but not twice in one stream
  const mine = (await call('GET', '/api/bootstrap')).body;
  assert.equal(mine.tests.map((t) => t.name).join(), 'ME mock');
  assert.equal(mine.mistakes.length, 1);

  // deleting: refused while it has mistakes; allowed (with its tests etc.) when it has none
  assert.equal((await call('DELETE', `/api/streams/${me.id}`)).status, 400);
  assert.equal((await call('DELETE', `/api/streams/${other.id}`)).status, 200);
  assert.equal((await call('GET', '/api/streams')).body.length, 2);
  assert.equal((await call('DELETE', `/api/streams/${da.id}`)).status, 200); // DA has no mistakes here, so it can go
  assert.equal((await call('DELETE', `/api/streams/${me.id}`)).status, 400); // ME has mistakes (and would be the last stream)
  void sub;
  await app.close();
});
