// To-do: today's tasks, the week at a glance, and the syllabus checklist. Time is tracked on the Timer page;
// the ▶ button on a task starts the timer for it.
import { mount, D, esc, $, api, subjectOpts, subName, fail, dur, pct, topicsOf, openModal } from './util.js';
import { startTask } from './timer.js';
import { goalsCard, bindGoals } from './goals.js';
import { addDays, weekStart, dayName, shortDate } from '/shared/dates.js';

let tab = 'today';
let wk = null;
let openSubjects = new Set();

const spent = (taskId) => D.studyLog.filter((l) => l.task_id === taskId).reduce((a, l) => a + l.minutes, 0);

export function renderTodo(host, refresh) {
  const root = mount(host);
  const todays = D.tasks.filter((t) => t.date === D.today);
  const ws = weekStart(D.today);
  const wkTasks = D.tasks.filter((t) => t.date >= ws && t.date <= addDays(ws, 6));
  const backlog = D.tasks.filter((t) => !t.done && t.date < D.today).length;
  const chip = (v, l) => `<span class="pillstat"><b>${v}</b> ${l}</span>`;
  root.innerHTML = `
<div class="page-head"><div><h1>To-do</h1><p>${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
  <div class="row">${chip(`${todays.filter((t) => t.done).length}/${todays.length}`, 'today')}${chip(`${wkTasks.filter((t) => t.done).length}/${wkTasks.length}`, 'this week')}${backlog ? chip(backlog, 'backlog') : ''}</div></div>
<div class="tabs" role="tablist">${[['today', 'Today'], ['week', 'Week board'], ['syllabus', 'Syllabus']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
<div id="tabBody"></div>`;
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) ((tab = t.dataset.tab), renderTodo(host, refresh));
  });
  ({ today, week, syllabus })[tab]($('#tabBody', root), refresh);
}

/* ------------------------------ cards + board helpers ------------------------------ */
const hue = (t) => (t.subject_id ? (t.subject_id * 47) % 360 : 250);

function card(t) {
  const m = spent(t.id);
  return `<div class="tcard${t.done ? ' done' : ''}" style="--h:${hue(t)}" draggable="true" data-card="${t.id}">
  <input type="checkbox" data-chk="${t.id}"${t.done ? ' checked' : ''} aria-label="Done: ${esc(t.title)}">
  <div class="cmain"><span class="tt" data-edit="${t.id}">${esc(t.title)}</span><div class="cmeta">${t.subject_id ? `<span class="sd"></span><span class="sn">${esc(subName(t.subject_id))}</span>` : ''}${m ? `<span>${dur(m)}</span>` : ''}</div></div>
  ${t.done ? '' : `<button class="go" data-play="${t.id}" title="Start the timer on this" aria-label="Start timer">▶</button>`}</div>`;
}

function row(t, { date = false } = {}) {
  const m = spent(t.id);
  return `<div class="trow${t.done ? ' done' : ''}" style="--h:${hue(t)}">
  <input type="checkbox" data-chk="${t.id}"${t.done ? ' checked' : ''} aria-label="Done: ${esc(t.title)}">
  <div class="tmain"><span class="tt" data-edit="${t.id}">${esc(t.title)}</span><div class="tmeta">${date ? `<span>${esc(shortDate(t.date))}</span>` : ''}${t.subject_id ? `<span class="tag">${esc(subName(t.subject_id))}</span>` : ''}${m ? `<span>${dur(m)} studied</span>` : ''}</div></div>
  ${t.done ? '' : `<button class="go" data-play="${t.id}" title="Start the timer on this" aria-label="Start timer">▶</button>`}</div>`;
}

/** Click / change handling shared by the Today list and the board. */
function bindCards(body, refresh) {
  body.addEventListener('click', async (e) => {
    try {
      const pl = e.target.closest('[data-play]');
      if (pl) return (startTask(pl.dataset.play), (location.hash = '#/timer'));
      const ed = e.target.closest('[data-edit]');
      if (ed) return editTask(D.tasks.find((t) => t.id === Number(ed.dataset.edit)), refresh);
      const td = e.target.closest('[data-today]');
      if (td) return (await api('PUT', `/api/tasks/${td.dataset.today}`, { date: D.today }), refresh());
      const add = e.target.closest('[data-addcol]');
      if (add) {
        const col = add.closest('.col');
        if (col.querySelector('input.quick')) return col.querySelector('input.quick').focus();
        const inp = document.createElement('input');
        inp.className = 'quick'; inp.placeholder = 'Task title, then Enter'; inp.maxLength = 300;
        col.querySelector('.colbody').prepend(inp);
        inp.focus();
        const done = async (save) => {
          const title = inp.value.trim();
          if (save && title) try { await api('POST', '/api/tasks', { title, date: add.dataset.addcol, kind: 'study' }); await refresh(); } catch (ex) { fail(ex); }
          else refresh(false);
        };
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true), { once: true });
      }
    } catch (ex) { fail(ex); }
  });
  body.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-chk]');
    if (c) try { await api('PUT', `/api/tasks/${c.dataset.chk}`, { done: c.checked }); await refresh(); } catch (ex) { fail(ex); }
  });
  // drag a card to another day to reschedule it
  let dragId = null;
  body.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('[data-card]');
    if (!c) return;
    dragId = Number(c.dataset.card);
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  body.addEventListener('dragend', (e) => { e.target.closest?.('[data-card]')?.classList.remove('dragging'); body.querySelectorAll('.col.drop').forEach((c) => c.classList.remove('drop')); });
  body.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('.col[data-date]');
    if (!col || dragId == null) return;
    e.preventDefault();
    body.querySelectorAll('.col.drop').forEach((c) => c !== col && c.classList.remove('drop'));
    col.classList.add('drop');
  });
  body.addEventListener('drop', async (e) => {
    const col = e.target.closest?.('.col[data-date]');
    if (!col || dragId == null) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    try { await api('PUT', `/api/tasks/${id}`, { date: col.dataset.date }); await refresh(); } catch (ex) { fail(ex); }
  });
}

function editTask(t, refresh) {
  if (!t) return;
  const m = openModal('Edit to-do', `<form autocomplete="off"><div class="fgrid">
    <label class="full"><span class="lab">Title</span><input name="title" value="${esc(t.title)}" maxlength="300" required></label>
    <label><span class="lab">Date</span><input name="date" type="date" value="${esc(t.date)}" required></label>
    <label><span class="lab">Subject</span><select name="subject_id"><option value="">—</option>${subjectOpts(t.subject_id)}</select></label>
  </div><p class="err" data-err></p>
  <div class="row" style="margin-top:10px"><button class="btn primary">Save</button><button type="button" class="btn danger" id="delT" style="margin-left:auto">Delete</button></div></form>`);
  $('form', m.dlg).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try { await api('PUT', `/api/tasks/${t.id}`, { title: f.title.value, date: f.date.value, subject_id: f.subject_id.value }); m.close(); await refresh(); } catch (ex) { $('[data-err]', m.dlg).textContent = ex.message; }
  });
  $('#delT', m.dlg).addEventListener('click', async () => {
    try { await api('DELETE', `/api/tasks/${t.id}`); m.close(); await refresh(); } catch (ex) { fail(ex); }
  });
}

/* ------------------------------ today ------------------------------ */
function today(host, refresh) {
  const body = mount(host);
  const list = D.tasks.filter((t) => t.date === D.today);
  const missed = D.tasks.filter((t) => !t.done && t.date < D.today);
  const soon = D.tasks.filter((t) => !t.done && t.date > D.today && t.date <= addDays(D.today, 7)).sort((x, y) => x.date.localeCompare(y.date));
  const doneN = list.filter((t) => t.done).length;
  const open = list.filter((t) => !t.done), done = list.filter((t) => t.done);
  body.innerHTML = `
<div class="todogrid">
<div class="todomain">
  <form id="tf" class="card quickadd" autocomplete="off">
    <input name="title" required placeholder="Add a to-do…" maxlength="300" aria-label="New to-do">
    <select name="subject_id" aria-label="Subject"><option value="">Subject</option>${subjectOpts()}</select>
    <input name="date" type="date" value="${esc(D.today)}" aria-label="Date">
    <button class="btn primary">Add</button>
  </form>
  <section class="card"><div class="row between"><h2 style="margin:0">Today</h2><span class="muted small">${list.length ? `${doneN} of ${list.length} done` : ''}</span></div>
    ${list.length ? `<div class="prog" style="margin:10px 0 4px"><div style="width:${(doneN / list.length) * 100}%"></div></div>` : ''}
    <div class="scrollbox" style="max-height:56vh">${open.map((t) => row(t)).join('')}${done.length ? `<div class="grouplabel">Completed</div>${done.map((t) => row(t)).join('')}` : ''}${list.length ? '' : '<p class="muted small" style="margin:12px 0 0">Nothing planned for today yet — add your first to-do above.</p>'}</div></section>
</div>
<div class="todoside">
  ${goalsCard(weekStart(D.today))}
  <section class="card"><div class="row between"><h2 style="margin:0">Backlog</h2>${missed.length ? '<button class="btn small" id="allToday">Move all to today</button>' : ''}</div>
    <div class="scrollbox" style="max-height:240px;margin-top:6px">${missed.length ? [...missed].reverse().map((t) => row(t, { date: true })).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing overdue. 🎉</p>'}</div></section>
  <section class="card"><h2 style="margin-bottom:2px">Coming up</h2>
    <div class="scrollbox" style="max-height:240px">${soon.length ? soon.map((t) => row(t, { date: true })).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing scheduled in the next 7 days.</p>'}</div></section>
</div></div>`;
  const f = $('#tf', body).elements;
  $('#tf', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/tasks', { title: f.title.value, date: f.date.value || D.today, kind: 'study', subject_id: f.subject_id.value }); await refresh(); } catch (ex) { fail(ex); }
  });
  bindCards(body, refresh);
  bindGoals(body, refresh);
  $('#allToday', body)?.addEventListener('click', async () => {
    try { for (const t of missed) await api('PUT', `/api/tasks/${t.id}`, { date: D.today }); await refresh(); } catch (ex) { fail(ex); }
  });
}

/* ------------------------------ week board ------------------------------ */
function week(host, refresh) {
  const body = mount(host);
  wk ||= weekStart(D.today);
  const days = [...Array(7)].map((_, i) => addDays(wk, i));
  const all = D.tasks.filter((t) => t.date >= days[0] && t.date <= days[6]);
  const doneN = all.filter((t) => t.done).length;
  const weekMin = days.reduce((a, d) => a + D.studyLog.filter((l) => l.date === d).reduce((x, l) => x + l.minutes, 0), 0);
  const missed = D.tasks.filter((t) => !t.done && t.date < D.today);
  const isNow = days.includes(D.today);
  body.innerHTML = `
<section class="card wkhead">
  <div class="row between"><div class="seg2"><button id="prevW" aria-label="Previous week">‹</button><button id="thisW"${isNow ? ' aria-current="true"' : ''}>${isNow ? 'This week' : 'Go to this week'}</button><button id="nextW" aria-label="Next week">›</button></div>
    <b>${shortDate(days[0])} – ${shortDate(days[6])}</b></div>
  <div class="wkprog"><div class="prog"><div style="width:${all.length ? (doneN / all.length) * 100 : 0}%"></div></div><span class="muted small">${doneN}/${all.length} done · ${dur(weekMin) || '0m'} studied</span></div>
</section>
${goalsCard(wk)}
${missed.length && isNow ? `<section class="backlogbar"><div class="row between"><span><b>Backlog</b> <span class="muted small">· ${missed.length} overdue — drag onto a day or</span></span><button class="btn small" id="allToday">move all to today</button></div>
  <div class="bchips">${missed.slice(-12).map((t) => `<span class="bchip" style="--h:${hue(t)}" draggable="true" data-card="${t.id}"><span data-edit="${t.id}">${esc(t.title)}</span><small>${esc(shortDate(t.date))}</small><button data-today="${t.id}" title="Move to today" aria-label="Move to today">→</button></span>`).join('')}</div></section>` : ''}
<div class="board7">${days.map((d) => {
    const ts = D.tasks.filter((t) => t.date === d).sort((x, y) => x.done - y.done || x.id - y.id);
    const logged = D.studyLog.filter((l) => l.date === d).reduce((a, l) => a + l.minutes, 0);
    const tests = D.tests.filter((t) => t.date === d);
    return `<div class="col wcol${d === D.today ? ' today' : ''}${d < D.today ? ' past' : ''}" data-date="${d}">
      <div class="ch"><div class="chd"><span class="dow">${dayName(d)}</span><span class="dnum">${Number(d.slice(8))}</span></div><div class="chm">${ts.length ? `${ts.filter((t) => t.done).length}/${ts.length}` : ''}${logged ? `<small>${dur(logged)}</small>` : ''}</div><button class="plus" data-addcol="${d}" aria-label="Add task on ${d}" title="Add task">＋</button></div>
      ${tests.map((t) => `<div class="badge info" style="margin:0 0 8px">📝 ${esc(t.name)}</div>`).join('')}
      <div class="colbody">${ts.map(card).join('') || '<div class="emptyday">Free</div>'}</div></div>`;
  }).join('')}</div>
<p class="hint" style="margin:10px 2px 0">Drag a card to another day to move it · tap a title to edit.</p>`;
  bindCards(body, refresh);
  bindGoals(body, refresh);
  $('#prevW', body).addEventListener('click', () => ((wk = addDays(wk, -7)), week(host, refresh)));
  $('#nextW', body).addEventListener('click', () => ((wk = addDays(wk, 7)), week(host, refresh)));
  $('#thisW', body).addEventListener('click', () => ((wk = weekStart(D.today)), week(host, refresh)));
  $('#allToday', body)?.addEventListener('click', async () => {
    try { for (const t of missed) await api('PUT', `/api/tasks/${t.id}`, { date: D.today }); await refresh(); } catch (ex) { fail(ex); }
  });
  const tc = $('.wcol.today', body), bd = $('.board7', body);
  if (tc && bd) bd.scrollLeft = Math.max(0, tc.offsetLeft + tc.offsetWidth - bd.offsetLeft - bd.clientWidth + 8); // only scroll as far as needed to show today
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
