// Schedule & Tracker: weekly planner, study-time log, syllabus progress tracker.
import { mount, D, esc, $, api, opts, subjectOpts, subName, toast, fail, empty, dur, pct, topicsOf } from './util.js';
import { renderPomodoro } from './pomodoro.js';
import { addDays, weekStart, dayName, shortDate, diffDays } from '/shared/dates.js';

let tab = 'planner';
let wk = null;
let openSubjects = new Set();
const KINDS = [['study', 'Study'], ['revision', 'Revision'], ['mock', 'Mock / test'], ['pyq', 'PYQ'], ['analysis', 'Test analysis'], ['other', 'Other']];
const KIND_ICON = { study: '📖', revision: '🔁', mock: '📝', pyq: '📚', analysis: '🔍', other: '•' };
const ACTIVITIES = ['Study', 'Revision', 'Practice', 'Mock', 'PYQ', 'Test analysis', 'Mistake review', 'Other'];

export function renderSchedule(host, refresh) {
  const root = mount(host);
  wk ||= weekStart(D.today);
  root.innerHTML = `
<div class="page-head"><div><h1>Schedule & tracker</h1><p id="examLine"></p></div></div>
<div class="tabs" role="tablist">${[['planner', 'Weekly planner'], ['log', 'Study log'], ['syllabus', 'Syllabus tracker']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
<div id="tabBody"></div>`;
  const exam = D.settings.general.examDate;
  $('#examLine', root).innerHTML = exam
    ? `<b>${Math.max(0, diffDays(exam, D.today))}</b> days to the exam (${esc(exam)}) · about ${Math.max(0, Math.ceil(diffDays(exam, D.today) / 7))} weeks`
    : 'Set your exam date in <a href="#/settings">Settings</a> to see a countdown.';
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) ((tab = t.dataset.tab), renderSchedule(host, refresh));
  });
  const body = $('#tabBody', root);
  ({ planner: planner, log: studyLog, syllabus: syllabus })[tab](body, refresh);
}

/* ------------------------------ planner ------------------------------ */
function planner(host, refresh) {
  const body = mount(host);
  const days = [...Array(7)].map((_, i) => addDays(wk, i));
  const missed = D.tasks.filter((t) => !t.done && t.date < D.today);
  const unresolved = D.live.filter((m) => m.status !== 'mastered');
  body.innerHTML = `
<div class="card"><form id="tf" class="fgrid" autocomplete="off">
  <label class="full"><span class="lab">New task</span><input name="title" required placeholder="e.g. Finish SVM dual problems" maxlength="300"></label>
  <label><span class="lab">Date</span><input type="date" name="date" value="${esc(D.today)}" required></label>
  <label><span class="lab">Kind</span><select name="kind">${opts(KINDS, 'study')}</select></label>
  <label><span class="lab">Subject</span><select name="subject_id"><option value="">—</option>${subjectOpts()}</select></label>
  <label><span class="lab">Topic</span><select name="topic_id"><option value="">—</option></select></label>
  <label><span class="lab">Minutes</span><input type="number" name="minutes" min="0" step="5" placeholder="60"></label>
  <label><span class="lab">Repeat weekly for (extra weeks)</span><input type="number" name="repeat_weeks" min="0" max="30" value="0"></label>
  <div style="align-self:end"><button class="btn primary">Add task</button></div>
</form></div>
${missed.length ? `<div class="card"><h2>Missed tasks (${missed.length})</h2>${missed.slice(-12).map((t) => `<div class="task"><span class="tt">${esc(t.title)} <span class="muted small">${esc(t.date)}</span></span><button data-today="${t.id}" title="Move to today" aria-label="Move to today">→ today</button><button data-done="${t.id}" aria-label="Mark done">✓</button><button data-del="${t.id}" aria-label="Delete">✕</button></div>`).join('')}${missed.length > 12 ? `<p class="muted small">Showing the latest 12 of ${missed.length}.</p>` : ''}</div>` : ''}
<div class="row between" style="margin-bottom:8px"><div class="row"><button class="btn" id="prevW" aria-label="Previous week">‹</button><button class="btn" id="thisW">This week</button><button class="btn" id="nextW" aria-label="Next week">›</button></div><b>${shortDate(days[0])} – ${shortDate(days[6])}</b></div>
<div class="week">${days
    .map((d) => {
      const ts = D.tasks.filter((t) => t.date === d);
      const dueN = d === D.today ? unresolved.filter((m) => m.next_review <= d).length : d > D.today ? unresolved.filter((m) => m.next_review === d).length : 0;
      const tests = D.tests.filter((t) => t.date === d);
      const planned = ts.reduce((a, t) => a + (t.minutes || 0), 0);
      const logged = D.studyLog.filter((l) => l.date === d).reduce((a, l) => a + l.minutes, 0);
      return `<div class="day${d === D.today ? ' today' : ''}"><h4><span>${dayName(d)} ${shortDate(d)}</span><button class="btn ghost small" data-adddate="${d}" aria-label="Add task on ${d}">＋</button></h4>
      ${dueN ? `<a href="#/review" class="badge warn" style="text-decoration:none">${dueN} review${dueN > 1 ? 's' : ''} ${d === D.today ? 'due' : 'scheduled'}</a>` : ''}
      ${tests.map((t) => `<div class="badge info" style="margin-top:4px">📝 ${esc(t.name)}</div>`).join('')}
      ${ts.map((t) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-chk="${t.id}"${t.done ? ' checked' : ''} aria-label="Done: ${esc(t.title)}"><span class="tt">${KIND_ICON[t.kind] || ''} ${esc(t.title)}${t.minutes ? ` <span class="muted small">${dur(t.minutes)}</span>` : ''}${t.subject_id ? `<div class="muted small">${esc(subName(t.subject_id))}</div>` : ''}</span><button data-del="${t.id}" aria-label="Delete task">✕</button></div>`).join('')}
      ${planned || logged ? `<div class="muted small" style="margin-top:6px">Planned ${dur(planned) || '0m'} · logged ${dur(logged) || '0m'}</div>` : ''}</div>`;
    })
    .join('')}</div>`;

  const f = $('#tf', body).elements;
  f.subject_id.addEventListener('change', () => (f.topic_id.innerHTML = '<option value="">—</option>' + opts(f.subject_id.value ? topicsOf(Number(f.subject_id.value)).map((t) => [t.id, t.name]) : [], '')));
  $('#tf', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/tasks', { title: f.title.value, date: f.date.value, kind: f.kind.value, subject_id: f.subject_id.value, topic_id: f.topic_id.value, minutes: f.minutes.value, repeat_weeks: f.repeat_weeks.value });
      toast(Number(f.repeat_weeks.value) ? `Added, repeating for ${f.repeat_weeks.value} more week(s)` : 'Task added');
      wk = weekStart(f.date.value);
      await refresh();
    } catch (ex) { fail(ex); }
  });
  $('#prevW', body).addEventListener('click', () => ((wk = addDays(wk, -7)), planner(host, refresh)));
  $('#nextW', body).addEventListener('click', () => ((wk = addDays(wk, 7)), planner(host, refresh)));
  $('#thisW', body).addEventListener('click', () => ((wk = weekStart(D.today)), planner(host, refresh)));
  body.addEventListener('click', async (e) => {
    try {
      const ad = e.target.closest('[data-adddate]');
      if (ad) return ((f.date.value = ad.dataset.adddate), f.title.focus());
      const del = e.target.closest('[data-del]');
      if (del) return (await api('DELETE', `/api/tasks/${del.dataset.del}`), refresh());
      const td = e.target.closest('[data-today]');
      if (td) return (await api('PUT', `/api/tasks/${td.dataset.today}`, { date: D.today }), refresh());
      const dn = e.target.closest('[data-done]');
      if (dn) return (await api('PUT', `/api/tasks/${dn.dataset.done}`, { done: true }), refresh());
    } catch (ex) { fail(ex); }
  });
  body.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-chk]');
    if (c) try { await api('PUT', `/api/tasks/${c.dataset.chk}`, { done: c.checked }); await refresh(); } catch (ex) { fail(ex); }
  });
}

/* ------------------------------ study log ------------------------------ */
function studyLog(host, refresh) {
  const body = mount(host);
  const log = D.studyLog;
  const byDay = new Map();
  for (const l of log) byDay.set(l.date, (byDay.get(l.date) || 0) + l.minutes);
  const sumRange = (from, to) => log.filter((l) => l.date >= from && l.date <= to).reduce((a, l) => a + l.minutes, 0);
  const ws = weekStart(D.today);
  let streak = 0;
  for (let d = byDay.has(D.today) ? D.today : addDays(D.today, -1); byDay.has(d); d = addDays(d, -1)) streak++;
  const target = D.settings.general.dailyTargetMin;
  const subTotals = D.subjects.map((s) => ({ s, m: log.filter((l) => l.subject_id === s.id && l.date >= ws).reduce((a, l) => a + l.minutes, 0) })).filter((x) => x.m);
  const maxSub = Math.max(...subTotals.map((x) => x.m), 1);
  const start = addDays(weekStart(D.today), -7 * 15);
  const cells = [];
  for (let d = start; d <= addDays(weekStart(D.today), 6); d = addDays(d, 1)) {
    const m = byDay.get(d) || 0;
    const ref = target || 240;
    const lv = !m ? '' : m < ref * 0.34 ? 'l1' : m < ref * 0.67 ? 'l2' : m < ref ? 'l3' : 'l4';
    cells.push(`<i class="${lv}" title="${d}: ${m ? dur(m) : 'nothing logged'}"${d > D.today ? ' style="opacity:.25"' : ''}></i>`);
  }
  body.innerHTML = `
<div class="tiles">
  <div class="tile"><div class="v">${dur(byDay.get(D.today) || 0) || '0m'}</div><div class="l">Today${target ? ` (target ${dur(target)})` : ''}</div></div>
  <div class="tile"><div class="v">${dur(sumRange(ws, addDays(ws, 6))) || '0m'}</div><div class="l">This week</div></div>
  <div class="tile"><div class="v">${dur(sumRange(addDays(D.today, -29), D.today)) || '0m'}</div><div class="l">Last 30 days</div></div>
  <div class="tile"><div class="v">${streak}</div><div class="l">Day streak</div></div>
</div>
<div id="pomo"></div>
<div class="grid g2">
<section class="card"><h2>Log study time</h2>
<form id="lf" class="fgrid" autocomplete="off">
  <label><span class="lab">Date</span><input type="date" name="date" value="${esc(D.today)}" max="${esc(D.today)}" required></label>
  <label><span class="lab">Subject</span><select name="subject_id"><option value="">—</option>${subjectOpts()}</select></label>
  <label><span class="lab">Hours</span><input type="number" name="h" min="0" max="23" value="1"></label>
  <label><span class="lab">Minutes</span><input type="number" name="m" min="0" max="59" step="5" value="0"></label>
  <label><span class="lab">Activity</span><select name="activity">${opts(ACTIVITIES.map((a) => [a, a]), 'Study')}</select></label>
  <label><span class="lab">Note</span><input name="note" maxlength="1000"></label>
  <div><button class="btn primary">Log time</button></div>
</form></section>
<section class="card"><h2>This week by subject</h2>${subTotals.length ? `<div class="bars">${subTotals.sort((a, b) => b.m - a.m).map((x) => `<div class="br"><span>${esc(x.s.name)}</span><div class="track"><div class="fill" style="width:${(x.m / maxSub) * 100}%"></div></div><span class="right">${dur(x.m)}</span></div>`).join('')}</div>` : empty('Nothing logged this week yet.')}</section>
</div>
<section class="card"><h2>Consistency (last 16 weeks)</h2><div class="cal" aria-label="Study consistency calendar">${cells.join('')}</div><p class="hint">Darker = closer to your daily target${target ? '' : ' (no target set — using 4 h; set one in Settings)'}. Columns are weeks, rows Monday → Sunday.</p></section>
<section class="card"><h2>Recent entries</h2>${log.length ? `<div class="tablewrap"><table><tbody>${[...log].reverse().slice(0, 25).map((l) => `<tr><td class="nowrap">${esc(l.date)}</td><td>${esc(l.subject_id ? subName(l.subject_id) : '—')}</td><td>${esc(l.activity || '')}</td><td class="num">${dur(l.minutes)}</td><td class="muted">${esc(l.note || '')}</td><td class="right"><button class="btn ghost small" data-dl="${l.id}" aria-label="Delete entry">✕</button></td></tr>`).join('')}</tbody></table></div>` : empty('No study time logged yet.')}</section>`;
  renderPomodoro($('#pomo', body), ACTIVITIES);
  $('#lf', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const minutes = Number(f.h.value || 0) * 60 + Number(f.m.value || 0);
    try {
      await api('POST', '/api/log', { date: f.date.value, subject_id: f.subject_id.value, minutes, activity: f.activity.value, note: f.note.value });
      toast('Logged');
      await refresh();
    } catch (ex) { fail(ex); }
  });
  body.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-dl]');
    if (d) try { await api('DELETE', `/api/log/${d.dataset.dl}`); await refresh(); } catch (ex) { fail(ex); }
  });
}

/* ------------------------------ syllabus tracker ------------------------------ */
function syllabus(host, refresh) {
  const body = mount(host);
  const prog = new Map(D.progress.map((p) => [p.topic_id, p]));
  const tops = D.topics.filter((t) => !t.parent_id);
  const studied = tops.filter((t) => prog.get(t.id)?.studied).length;
  const pyq = tops.filter((t) => prog.get(t.id)?.pyq_done).length;
  const revs = tops.reduce((a, t) => a + (prog.get(t.id)?.revision_count || 0), 0);
  body.innerHTML = `
<div class="tiles">
  <div class="tile"><div class="v">${tops.length ? pct(studied / tops.length) : '—'}</div><div class="l">Topics studied (${studied}/${tops.length})</div></div>
  <div class="tile"><div class="v">${revs}</div><div class="l">Total revision passes</div></div>
  <div class="tile"><div class="v">${pyq}</div><div class="l">Topics with PYQs done</div></div>
</div>
<p class="muted small">Your own checklist of what you have covered.</p>
${(() => { let prev; return D.subjects.map((s) => {
    const head = s.section && s.section !== prev ? `<div class="sectionhead">${esc(s.section)}</div>` : '';
    prev = s.section;
    const ts = topicsOf(s.id);
    const st = ts.filter((t) => prog.get(t.id)?.studied).length;
    return head + `<details class="card" data-subj="${s.id}"${openSubjects.has(s.id) ? ' open' : ''}><summary class="row between" style="cursor:pointer"><b>${esc(s.name)}</b><span class="row"><span class="muted small">${st}/${ts.length} studied</span><span class="prog" style="width:120px"><div style="width:${ts.length ? (st / ts.length) * 100 : 0}%"></div></span></span></summary>
    <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Topic</th><th>Studied</th><th>Revisions</th><th>PYQs</th><th>Notes</th></tr></thead><tbody>${ts.map((t) => {
      const p = prog.get(t.id) || {};
      return `<tr data-t="${t.id}"><td>${esc(t.name)}</td><td><input type="checkbox" data-f="studied"${p.studied ? ' checked' : ''} aria-label="Studied: ${esc(t.name)}"></td><td class="nowrap"><button class="btn small" data-rev="-1" aria-label="Fewer revisions">−</button> <b>${p.revision_count || 0}</b> <button class="btn small" data-rev="1" aria-label="More revisions">＋</button></td><td><input type="checkbox" data-f="pyq_done"${p.pyq_done ? ' checked' : ''} aria-label="PYQs done: ${esc(t.name)}"></td><td><input data-f="notes" value="${esc(p.notes || '')}" placeholder="…" style="width:100%;min-width:120px" aria-label="Notes: ${esc(t.name)}"></td></tr>`;
    }).join('')}</tbody></table></div></details>`;
  }).join(''); })()}`;
  body.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('[data-subj]');
    if (d) d.open ? openSubjects.add(Number(d.dataset.subj)) : openSubjects.delete(Number(d.dataset.subj));
  }, true);
  const save = async (tr, patch) => {
    try {
      await api('PUT', `/api/progress/${tr.dataset.t}`, patch);
      await refresh();
    } catch (ex) { fail(ex); }
  };
  body.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-t]');
    if (!tr || !e.target.dataset.f) return;
    save(tr, { [e.target.dataset.f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rev]');
    if (!b) return;
    const tr = b.closest('tr');
    const cur = prog.get(Number(tr.dataset.t))?.revision_count || 0;
    save(tr, { revision_count: Math.max(0, cur + Number(b.dataset.rev)) });
  });

}
