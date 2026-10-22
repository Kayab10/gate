// To-do: today's tasks, the week at a glance, and the syllabus checklist. Time is tracked on the Timer page;
// the ▶ button on a task starts the timer for it.
import { mount, D, esc, $, api, opts, subjectOpts, subName, toast, fail, empty, dur, pct, topicsOf } from './util.js';
import { startTask } from './timer.js';
import { addDays, weekStart, dayName, shortDate } from '/shared/dates.js';

let tab = 'today';
let wk = null;
let openSubjects = new Set();

const spent = (taskId) => D.studyLog.filter((l) => l.task_id === taskId).reduce((a, l) => a + l.minutes, 0);

export function renderTodo(host, refresh) {
  const root = mount(host);
  root.innerHTML = `
<div class="page-head"><div><h1>To-do</h1></div></div>
<div class="tabs" role="tablist">${[['today', 'Today'], ['week', 'This week'], ['syllabus', 'Syllabus']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
<div id="tabBody"></div>`;
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) ((tab = t.dataset.tab), renderTodo(host, refresh));
  });
  ({ today, week, syllabus })[tab]($('#tabBody', root), refresh);
}

const taskRow = (t, { showDate = false } = {}) => {
  const m = spent(t.id);
  return `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-chk="${t.id}"${t.done ? ' checked' : ''} aria-label="Done: ${esc(t.title)}"><span class="tt">${esc(t.title)}${showDate ? ` <span class="muted small">${esc(t.date)}</span>` : ''}${t.subject_id || m ? `<div class="muted small">${[t.subject_id && esc(subName(t.subject_id)), m && `${dur(m)} studied`].filter(Boolean).join(' · ')}</div>` : ''}</span>${t.done ? '' : `<button data-play="${t.id}" title="Start the timer on this" aria-label="Start timer">▶</button>`}<button data-del="${t.id}" aria-label="Delete task">✕</button></div>`;
};

/** Shared by the Today and Week tabs: checkbox, play, delete. */
function bindTasks(body, refresh) {
  body.addEventListener('click', async (e) => {
    try {
      const del = e.target.closest('[data-del]');
      if (del) return (await api('DELETE', `/api/tasks/${del.dataset.del}`), refresh());
      const td = e.target.closest('[data-today]');
      if (td) return (await api('PUT', `/api/tasks/${td.dataset.today}`, { date: D.today }), refresh());
      const pl = e.target.closest('[data-play]');
      if (pl) return (startTask(pl.dataset.play), (location.hash = '#/timer'));
    } catch (ex) { fail(ex); }
  });
  body.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-chk]');
    if (c) try { await api('PUT', `/api/tasks/${c.dataset.chk}`, { done: c.checked }); await refresh(); } catch (ex) { fail(ex); }
  });
}

function addForm(date) {
  return `<form id="tf" class="card" autocomplete="off">
  <div class="row"><input name="title" required placeholder="Add a to-do…" maxlength="300" style="flex:1;min-width:200px" aria-label="New to-do"><button class="btn primary">Add</button></div>
  <details class="more" style="margin-top:8px"><summary>Date, subject, repeat</summary><div class="fgrid" style="margin-top:8px">
    <label><span class="lab">Date</span><input type="date" name="date" value="${esc(date)}" required></label>
    <label><span class="lab">Subject</span><select name="subject_id"><option value="">—</option>${subjectOpts()}</select></label>
    <label><span class="lab">Repeat weekly for (extra weeks)</span><input type="number" name="repeat_weeks" min="0" max="30" value="0"></label>
  </div></details></form>`;
}
function bindAdd(body, refresh) {
  const f = $('#tf', body).elements;
  $('#tf', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/tasks', { title: f.title.value, date: f.date.value, kind: 'study', subject_id: f.subject_id.value, repeat_weeks: f.repeat_weeks.value });
      toast(Number(f.repeat_weeks.value) ? `Added, repeating for ${f.repeat_weeks.value} more week(s)` : 'Added');
      wk = weekStart(f.date.value);
      await refresh();
    } catch (ex) { fail(ex); }
  });
}

/* ------------------------------ today ------------------------------ */
function today(host, refresh) {
  const body = mount(host);
  const list = D.tasks.filter((t) => t.date === D.today);
  const missed = D.tasks.filter((t) => !t.done && t.date < D.today);
  const doneN = list.filter((t) => t.done).length;
  body.innerHTML = `
${addForm(D.today)}
<section class="card"><div class="row between"><h2 style="margin:0">Today</h2><span class="muted small">${list.length ? `${doneN}/${list.length} done` : ''}</span></div>
  ${list.length ? `<div class="prog" style="margin:8px 0"><div style="width:${(doneN / list.length) * 100}%"></div></div>${list.map((t) => taskRow(t)).join('')}` : '<p class="muted small" style="margin:8px 0 0">Nothing planned for today yet.</p>'}</section>
${missed.length ? `<section class="card"><div class="row between"><h2 style="margin:0">Missed (${missed.length})</h2><button class="btn small" id="allToday">Move all to today</button></div>${missed.slice(-15).map((t) => `<div class="task"><span class="tt">${esc(t.title)} <span class="muted small">${esc(t.date)}</span></span><button data-today="${t.id}" title="Move to today">→ today</button><input type="checkbox" data-chk="${t.id}" aria-label="Mark done"><button data-del="${t.id}" aria-label="Delete">✕</button></div>`).join('')}${missed.length > 15 ? `<p class="muted small">Showing the latest 15 of ${missed.length}.</p>` : ''}</section>` : ''}`;
  bindAdd(body, refresh);
  bindTasks(body, refresh);
  $('#allToday', body)?.addEventListener('click', async () => {
    try {
      for (const t of missed) await api('PUT', `/api/tasks/${t.id}`, { date: D.today });
      await refresh();
    } catch (ex) { fail(ex); }
  });
}

/* ------------------------------ week ------------------------------ */
function week(host, refresh) {
  const body = mount(host);
  wk ||= weekStart(D.today);
  const days = [...Array(7)].map((_, i) => addDays(wk, i));
  const all = D.tasks.filter((t) => t.date >= days[0] && t.date <= days[6]);
  body.innerHTML = `
${addForm(days.includes(D.today) ? D.today : days[0])}
<div class="row between" style="margin-bottom:8px"><div class="row"><button class="btn" id="prevW" aria-label="Previous week">‹</button><button class="btn" id="thisW">This week</button><button class="btn" id="nextW" aria-label="Next week">›</button></div><span><b>${shortDate(days[0])} – ${shortDate(days[6])}</b> <span class="muted small">${all.filter((t) => t.done).length}/${all.length} done</span></span></div>
<div class="week">${days.map((d) => {
    const ts = D.tasks.filter((t) => t.date === d);
    const logged = D.studyLog.filter((l) => l.date === d).reduce((a, l) => a + l.minutes, 0);
    const tests = D.tests.filter((t) => t.date === d);
    return `<div class="day${d === D.today ? ' today' : ''}"><h4><span>${dayName(d)} ${shortDate(d)}</span>${logged ? `<span class="muted small">${dur(logged)}</span>` : ''}</h4>
      ${tests.map((t) => `<div class="badge info" style="margin-top:4px">📝 ${esc(t.name)}</div>`).join('')}
      ${ts.map((t) => taskRow(t)).join('') || '<div class="muted small">—</div>'}</div>`;
  }).join('')}</div>`;
  bindAdd(body, refresh);
  bindTasks(body, refresh);
  $('#prevW', body).addEventListener('click', () => ((wk = addDays(wk, -7)), week(host, refresh)));
  $('#nextW', body).addEventListener('click', () => ((wk = addDays(wk, 7)), week(host, refresh)));
  $('#thisW', body).addEventListener('click', () => ((wk = weekStart(D.today)), week(host, refresh)));
}

/* ------------------------------ syllabus checklist ------------------------------ */
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
${(() => { let prev; return D.subjects.map((s) => {
    const head = s.section && s.section !== prev ? `<div class="sectionhead">${esc(s.section)}</div>` : '';
    prev = s.section;
    const ts = topicsOf(s.id);
    const st = ts.filter((t) => prog.get(t.id)?.studied).length;
    return head + `<details class="card" data-subj="${s.id}"${openSubjects.has(s.id) ? ' open' : ''}><summary class="row between" style="cursor:pointer"><b>${esc(s.name)}</b><span class="row"><span class="muted small">${st}/${ts.length} studied</span><span class="prog" style="width:120px"><div style="width:${ts.length ? (st / ts.length) * 100 : 0}%"></div></span></span></summary>
    <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Topic</th><th>Studied</th><th>Revisions</th><th>PYQs</th></tr></thead><tbody>${ts.map((t) => {
      const p = prog.get(t.id) || {};
      return `<tr data-t="${t.id}"><td>${esc(t.name)}</td><td><input type="checkbox" data-f="studied"${p.studied ? ' checked' : ''} aria-label="Studied: ${esc(t.name)}"></td><td class="nowrap"><button class="btn small" data-rev="-1" aria-label="Fewer revisions">−</button> <b>${p.revision_count || 0}</b> <button class="btn small" data-rev="1" aria-label="More revisions">＋</button></td><td><input type="checkbox" data-f="pyq_done"${p.pyq_done ? ' checked' : ''} aria-label="PYQs done: ${esc(t.name)}"></td></tr>`;
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
    if (tr && e.target.dataset.f) save(tr, { [e.target.dataset.f]: e.target.checked });
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rev]');
    if (!b) return;
    const tr = b.closest('tr');
    save(tr, { revision_count: Math.max(0, (prog.get(Number(tr.dataset.t))?.revision_count || 0) + Number(b.dataset.rev)) });
  });
}
