import { mount, D, esc, $, api, opts, toast, fail, confirmDialog, askText } from './util.js';
import { DEFAULT_SRS } from '/shared/srs.js';
import { DEFAULT_PRIORITY } from '/shared/priority.js';
import { DEFAULT_PLANNER } from '/shared/planner.js';

const PRIORITY_FIELDS = [
  ['recurrence', 'Per recurrence in a later test', 'points added each time the same mistake is wrong again'],
  ['failedReview', 'Per failed review', ''], ['severity', 'Per severity level (1–5)', ''], ['marksLost', 'Per mark lost', ''],
  ['overdueDay', 'Per day overdue', ''], ['overdueCap', 'Overdue days counted (cap)', ''], ['sinceSuccessDay', 'Per day since last independent success', ''],
  ['sinceCap', 'Days-since cap', ''], ['importance', 'Per importance level away from 3', 'topic/subject importance you set yourself (default neutral)'],
  ['overconfidence', 'Per confidence level above 3 (when wrong)', 'being confidently wrong is a red flag'],
  ['masteredFactor', 'Multiplier once mastered', ''], ['highImpactThreshold', 'High-impact threshold', 'score at which an item is treated as “high impact” in the daily plan'],
];
const PLANNER_FIELDS = [
  ['minutesEasy', 'Minutes per easy review'], ['minutesMedium', 'Minutes per medium review'], ['minutesHard', 'Minutes per hard review'], ['minutesDefault', 'Minutes if difficulty unknown'],
  ['maintenanceMax', 'Max maintenance items per day'], ['aheadDays', 'Pull high-impact items forward by up to (days)'],
];
const openSubj = new Set();
const openKeys = new Set(); // details sections the user has opened
const isOpen = (k) => (openKeys.has(k) ? ' open' : '');

export function renderSettings(host, refresh) {
  const root = mount(host);
  const s = D.settings;
  const numForm = (key, title, fields, defaults, intro = '') => `<section class="card"><h2>${title}</h2>${intro}<form data-set="${key}"><div class="fgrid">${fields.map(([k, l, h]) => `<label><span class="lab">${esc(l)}</span><input type="number" step="any" name="${k}" value="${esc(s[key][k] ?? defaults[k])}">${h ? `<span class="hint">${esc(h)}</span>` : ''}</label>`).join('')}</div><div class="row" style="margin-top:10px"><button class="btn primary">Save</button><button type="button" class="btn" data-reset="${key}">Reset to defaults</button></div></form></section>`;

  root.innerHTML = `
<div class="page-head"><div><h1>Settings</h1><p>Saved to your account, so it is the same on every device.</p></div></div>
<section class="card"><h2>General</h2><form data-set="general"><div class="fgrid">
  <label><span class="lab">Exam date</span><input type="date" name="examDate" value="${esc(s.general.examDate)}"><span class="hint">Used for the countdown. Check the official GATE 2027 schedule and enter the date yourself.</span></label>
  <label><span class="lab">Daily study target (minutes)</span><input type="number" name="dailyTargetMin" min="0" step="15" value="${esc(s.general.dailyTargetMin)}"></label>
  <label><span class="lab">“Slow question” threshold (seconds)</span><input type="number" name="slowSeconds" min="10" value="${esc(s.general.slowSeconds)}"></label>
  <label><span class="lab">Default time budget for today’s plan (min)</span><input type="number" name="defaultBudgetMin" min="5" step="5" value="${esc(s.general.defaultBudgetMin)}"></label>
</div><div class="row" style="margin-top:10px"><button class="btn primary">Save</button></div></form></section>

<section class="card"><h2>Review schedule</h2><form data-set="srs"><div class="fgrid">
  <label class="full"><span class="lab">Intervals in days (comma separated; each measured from the previous review date)</span><input name="intervals" value="${esc(s.srs.intervals.join(', '))}"></label>
  <label><span class="lab">Retry interval after a failure (days)</span><input type="number" name="failInterval" min="1" value="${esc(s.srs.failInterval)}"></label>
  <label><span class="lab">Consecutive independent solves for mastery</span><input type="number" name="masteryStreak" min="1" value="${esc(s.srs.masteryStreak)}"></label>
  <label><span class="lab">Maintenance interval once mastered (days)</span><input type="number" name="maintenanceDays" min="1" value="${esc(s.srs.maintenanceDays)}"></label>
</div><div class="notice">Saving re-derives every mistake’s next review date from its review history using the new values. Manual next-review overrides are kept.</div>
<div class="row"><button class="btn primary">Save & recalculate</button><button type="button" class="btn" data-reset="srs">Reset to defaults</button></div></form></section>

<details class="more" data-key="advanced" style="margin-bottom:14px"${isOpen('advanced')}><summary>Advanced: priority weights & plan time estimates</summary>
${numForm('priority', 'Priority score weights', PRIORITY_FIELDS, DEFAULT_PRIORITY, '<p class="hint">The score is a plain sum of these components — every score shows its breakdown. No topic is assumed to be “high weightage” unless you raise its importance below.</p>')}
${numForm('planner', 'Daily plan time estimates', PLANNER_FIELDS, DEFAULT_PLANNER)}</details>

<details class="more" data-key="causes" style="margin-bottom:14px"${isOpen('causes')}><summary>Root-cause categories <span class="muted small">(${D.causes.length})</span></summary>
<p class="hint">Why a question went wrong. The guidance text appears in reviews and mistake details. Open a category to edit it.</p>
${D.causes.map((c) => `<details class="more" data-key="cause-${c.id}" data-kind="cause" data-id="${c.id}"${isOpen('cause-' + c.id)}><summary>${esc(c.name)}</summary>
  <div class="stack" style="margin:8px 0 10px"><div class="row"><input data-f="name" value="${esc(c.name)}" style="flex:1;min-width:200px" aria-label="Cause name"><button class="btn danger small" data-del-cause="${c.id}">Delete</button></div>
  <input data-f="description" value="${esc(c.description || '')}" placeholder="Description" style="width:100%" aria-label="Description"><textarea data-f="guidance" rows="3" placeholder="Corrective guidance" aria-label="Guidance">${esc(c.guidance || '')}</textarea></div></details>`).join('')}
<form id="addCause" class="row" style="margin:12px 0 4px"><input name="name" placeholder="New cause name" required><button class="btn">Add cause</button></form></details>

<section class="card"><h2>Syllabus: subjects, topics & subtopics</h2>
<p class="hint">Importance (1–5) is <b>your</b> judgement and feeds the priority score; 3 is neutral; a topic set to “as subject” uses its subject’s rating. Deleting a topic keeps its mistakes (they just lose the topic).</p>
${D.subjects.map((sub) => {
    const tops = D.topics.filter((t) => t.subject_id === sub.id && !t.parent_id);
    return `<details class="more" data-subj="${sub.id}"${openSubj.has(sub.id) ? ' open' : ''}><summary>${esc(sub.name)} <span class="muted small">(${tops.length} topics)</span></summary>
    <div class="row" data-kind="subject" data-id="${sub.id}" style="margin:8px 0"><input data-f="name" value="${esc(sub.name)}" aria-label="Subject name" style="flex:1;min-width:160px"><input data-f="section" value="${esc(sub.section || '')}" placeholder="Section" aria-label="Section" style="width:200px"><label class="row gap-s"><span class="muted small">Importance</span><select data-f="importance">${opts([1, 2, 3, 4, 5].map((n) => [n, n]), sub.importance)}</select></label><button class="btn danger small" data-del-subject="${sub.id}">Delete subject</button></div>
    ${tops.map((t) => {
      const subs = D.topics.filter((x) => x.parent_id === t.id);
      return `<div data-kind="topic" data-id="${t.id}" class="row" style="margin:3px 0"><input data-f="name" value="${esc(t.name)}" style="flex:1;min-width:200px" aria-label="Topic name"><select data-f="importance" aria-label="Importance">${opts([['', 'as subject'], ...[1, 2, 3, 4, 5].map((n) => [n, n])], t.importance ?? '')}</select><button class="btn small" data-add-sub="${t.id}" data-subj-id="${sub.id}">＋ subtopic</button><button class="btn small danger" data-del-topic="${t.id}" aria-label="Delete topic">✕</button></div>
      ${subs.map((x) => `<div data-kind="topic" data-id="${x.id}" class="row" style="margin:3px 0 3px 28px"><input data-f="name" value="${esc(x.name)}" style="flex:1;min-width:180px" aria-label="Subtopic name"><select data-f="importance" aria-label="Importance">${opts([['', 'as subject'], ...[1, 2, 3, 4, 5].map((n) => [n, n])], x.importance ?? '')}</select><button class="btn small danger" data-del-topic="${x.id}" aria-label="Delete subtopic">✕</button></div>`).join('')}`;
    }).join('')}
    <form class="row addTopic" data-subj-id="${sub.id}" style="margin-top:8px"><input name="name" placeholder="New topic in ${esc(sub.name)}" required style="flex:1"><button class="btn small">Add topic</button></form></details>`;
  }).join('')}
<form id="addSubject" class="row" style="margin-top:10px"><input name="name" placeholder="New subject name" required><input name="section" placeholder="Section (optional)"><button class="btn">Add subject</button></form></section>

<section class="card"><h2>Your data</h2><p>Everything you record — mistakes, reviews, tests, schedule, settings and screenshots — is stored in your account, so it is the same on your phone and laptop, and nobody else can see it.</p><button class="btn" id="logout">Sign out</button></section>`;

  root.addEventListener('toggle', (e) => {
    const k = e.target.dataset?.key;
    if (k) e.target.open ? openKeys.add(k) : openKeys.delete(k);
    const d = e.target.closest?.('[data-subj]');
    if (d) d.open ? openSubj.add(Number(d.dataset.subj)) : openSubj.delete(Number(d.dataset.subj));
  }, true);

  const put = async (key, value, msg = 'Saved') => {
    try { await api('PUT', `/api/settings/${key}`, { value }); toast(msg); await refresh(); } catch (e) { fail(e); }
  };
  $('#logout', root)?.addEventListener('click', async () => {
    await api('POST', '/api/logout');
    try { localStorage.removeItem('stream'); } catch { /* ignore */ }
    location.reload();
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target;
    e.preventDefault();
    try {
      if (f.dataset.set) {
        const key = f.dataset.set;
        const v = {};
        for (const el of f.elements) {
          if (!el.name) continue;
          if (key === 'srs' && el.name === 'intervals') v.intervals = el.value.split(/[,\s]+/).filter(Boolean).map(Number);
          else if (el.type === 'number') v[el.name] = el.value === '' ? 0 : Number(el.value);
          else v[el.name] = el.value;
        }
        return put(key, v, key === 'srs' ? 'Saved — review dates recalculated' : 'Saved');
      }
      if (f.id === 'addCause') { await api('POST', '/api/causes', { name: f.name.value }); await refresh(); }
      if (f.id === 'addSubject') { await api('POST', '/api/subjects', { name: f.name.value, section: f.section.value }); await refresh(); }
      if (f.classList.contains('addTopic')) { await api('POST', '/api/topics', { subject_id: Number(f.dataset.subjId), name: f.name.value }); await refresh(); }
    } catch (ex) { fail(ex); }
  });
  root.addEventListener('change', async (e) => {
    const row = e.target.closest('[data-kind]');
    if (!row || !e.target.dataset.f) return;
    const path = { cause: 'causes', subject: 'subjects', topic: 'topics' }[row.dataset.kind];
    let v = e.target.value;
    if (e.target.dataset.f === 'importance') v = v === '' ? (row.dataset.kind === 'topic' ? null : 3) : Number(v);
    try { await api('PUT', `/api/${path}/${row.dataset.id}`, { [e.target.dataset.f]: v }); toast('Saved'); await refresh(); } catch (ex) { fail(ex); }
  });
  root.addEventListener('click', async (e) => {
    try {
      const rs = e.target.closest('[data-reset]');
      if (rs) {
        const defaults = { srs: DEFAULT_SRS, priority: DEFAULT_PRIORITY, planner: DEFAULT_PLANNER }[rs.dataset.reset];
        if (await confirmDialog('Reset this section to its defaults?', { okLabel: 'Reset', danger: false })) await put(rs.dataset.reset, defaults, 'Reset to defaults');
        return;
      }
      const dc = e.target.closest('[data-del-cause]');
      if (dc && (await confirmDialog('Delete this cause category? (Not allowed while mistakes use it as primary cause.)'))) { await api('DELETE', `/api/causes/${dc.dataset.delCause}`); await refresh(); }
      const ds = e.target.closest('[data-del-subject]');
      if (ds && (await confirmDialog('Delete this subject and all its topics? (Not allowed while mistakes are recorded under it.)'))) { await api('DELETE', `/api/subjects/${ds.dataset.delSubject}`); await refresh(); }
      const dt = e.target.closest('[data-del-topic]');
      if (dt) {
        const id = Number(dt.dataset.delTopic);
        const n = D.mistakes.filter((m) => m.topic_id === id || m.subtopic_id === id).length;
        if (await confirmDialog(`Delete this topic (and its subtopics)?${n ? `\n\n${n} mistake(s) use it; they will be kept but lose this topic.` : ''}`)) { await api('DELETE', `/api/topics/${id}`); await refresh(); }
      }
      const as = e.target.closest('[data-add-sub]');
      if (as) {
        const name = await askText('New subtopic', 'Subtopic name');
        if (name) { await api('POST', '/api/topics', { subject_id: Number(as.dataset.subjId), parent_id: Number(as.dataset.addSub), name }); await refresh(); }
      }
    } catch (ex) { fail(ex); }
  });
}
