// Today: everything you need for the day on one screen, no forms.
import { mount, D, esc, $, api, subName, topName, fail, empty, dur, pct } from './util.js';
import { dueConcepts, startReview, KINDS } from './concepts.js';
import { startTask, runningInfo } from './timer.js';
import { TIERS } from './tests.js';
import { testStats } from '/shared/analytics.js';
import { diffDays, weekStart, addDays } from '/shared/dates.js';

export function renderToday(host, refresh) {
  const root = mount(host);
  const exam = D.settings.general.examDate;
  const target = D.settings.general.dailyTargetMin;
  const loggedToday = D.studyLog.filter((l) => l.date === D.today).reduce((a, l) => a + l.minutes, 0);
  const tasks = D.tasks.filter((t) => t.date === D.today);
  const doneN = tasks.filter((t) => t.done).length;
  const due = dueConcepts();
  const ws = weekStart(D.today);
  const week = D.tasks.filter((t) => t.date >= ws && t.date <= addDays(ws, 6));
  const latest = TIERS.map(([k, l]) => {
    const t = [...D.tests].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).find((x) => (x.tier || (x.type === 'topic' || x.type === 'subject' ? x.type : 'mock')) === k && testStats(x).scorePct != null);
    return { l, t, p: t ? testStats(t).scorePct : null };
  });
  const running = runningInfo();
  const studiedSet = new Set(D.progress.filter((p) => p.studied).map((p) => p.topic_id));
  const tops = D.topics.filter((t) => !t.parent_id);
  const bySub = D.subjects.map((sb) => { const ts = tops.filter((t) => t.subject_id === sb.id); return { sb, n: ts.length, done: ts.filter((t) => studiedSet.has(t.id)).length }; }).filter((x) => x.n);
  const sylPct = tops.length ? tops.filter((t) => studiedSet.has(t.id)).length / tops.length : 0;
  const C = 2 * Math.PI * 54;
  const byDay = new Map();
  for (const l of D.studyLog) byDay.set(l.date, (byDay.get(l.date) || 0) + l.minutes);
  const ref = target || 240;
  const heatStart = addDays(ws, -7 * 25);
  const cells = [];
  for (let d = heatStart; d <= addDays(ws, 6); d = addDays(d, 1)) {
    const m = byDay.get(d) || 0;
    const lv = d > D.today ? 'fut' : !m ? '' : m < ref * 0.34 ? 'l1' : m < ref * 0.67 ? 'l2' : m < ref ? 'l3' : 'l4';
    cells.push(`<i class="${lv}" title="${d}: ${m ? dur(m) : 'nothing logged'}"></i>`);
  }
  const weekMin = [...Array(7)].reduce((a, _, i) => a + (byDay.get(addDays(ws, i)) || 0), 0);
  const last30 = [...Array(30)].reduce((a, _, i) => a + (byDay.get(addDays(D.today, -i)) || 0), 0);
  let streak = 0;
  for (let d = byDay.has(D.today) ? D.today : addDays(D.today, -1); byDay.has(d); d = addDays(d, -1)) streak++;

  root.innerHTML = `
<div class="page-head"><div><h1>Today</h1><p>${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>${exam ? `<div class="countdown" title="Exam date: ${esc(exam)}"><b>${Math.max(0, diffDays(exam, D.today))}</b><span>days left</span></div>` : ''}</div>
<div class="tiles">
  <div class="tile"><div class="v">${dur(loggedToday) || '0m'}</div><div class="l">Studied today${target ? ` · target ${dur(target)}` : ''}</div>${target ? `<div class="prog" style="margin-top:6px"><div style="width:${Math.min(100, (loggedToday / target) * 100)}%"></div></div>` : ''}</div>
  <div class="tile ${due.length ? 'warn' : ''}"><div class="v">${due.length}</div><div class="l">Concepts to review</div></div>
  <div class="tile"><div class="v">${tasks.length ? `${doneN}/${tasks.length}` : '—'}</div><div class="l">Today's to-dos done</div></div>
  <div class="tile"><div class="v">${week.length ? `${week.filter((t) => t.done).length}/${week.length}` : '—'}</div><div class="l">This week's to-dos</div></div>
</div>
<div class="row" style="margin-bottom:16px">
  <a class="btn primary" href="#/timer">${running ? `⏱ Timer running · ${esc(running.text)}` : '▶ Start timer'}</a>
  ${due.length ? '<button class="btn" id="rev">Review concepts</button>' : ''}
</div>
<section class="card"><div class="row between"><h2 style="margin:0">Consistency</h2><span class="muted small">last 26 weeks</span></div>
  <div class="heatcard" style="margin-top:14px"><div class="heatwrap"><div class="heatdays" aria-hidden="true"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div><div class="heat" aria-label="Study consistency heat map">${cells.join('')}</div></div>
    <div class="heatstats"><div><b>${dur(weekMin) || '0m'}</b><span>this week</span></div><div><b>${dur(Math.round(last30 / 30)) || '0m'}</b><span>daily avg (30d)</span></div><div><b>${streak}d</b><span>streak</span></div></div>
    <span class="legend2">Less <i></i><i style="background:var(--heat1)"></i><i style="background:var(--heat2)"></i><i style="background:var(--heat3)"></i><i style="background:var(--heat4)"></i> More</span></div></section>
<div class="grid g2">
<section class="card"><div class="row between"><h2 style="margin:0">To-do today</h2><a href="#/todo" class="small">Open ›</a></div>
  ${tasks.length ? tasks.map((t) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-task="${t.id}"${t.done ? ' checked' : ''} aria-label="Done"><span class="tt">${esc(t.title)}${t.subject_id ? `<div class="muted small">${esc(subName(t.subject_id))}</div>` : ''}</span>${t.done ? '' : `<button data-play="${t.id}" aria-label="Start timer">▶</button>`}</div>`).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing planned. Add to-dos in the To-do tab.</p>'}</section>
<section class="card"><div class="row between"><h2 style="margin:0">Due for review</h2><a href="#/concepts" class="small">Concepts ›</a></div>
  ${due.length ? due.slice(0, 6).map((m) => `<div class="plan-item"><div><b>${esc(m.title)}</b><div class="muted small">${esc(subName(m.subject_id))}${m.topic_id ? ' › ' + esc(topName(m.topic_id)) : ''}</div></div><span class="badge">${KINDS[m.kind]?.[0] || ''}</span></div>`).join('') + (due.length > 6 ? `<p class="muted small">…and ${due.length - 6} more</p>` : '') : empty(D.live.length ? 'Nothing due — all caught up.' : 'Add a concept you found hard and it will show up here.')}</section>
</div>
<section class="card"><div class="row between"><h2 style="margin:0">Syllabus progress</h2><a href="#/todo" class="small">Checklist ›</a></div>
  <div class="syl" style="margin-top:14px"><div class="ringbox"><svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="rt" cx="60" cy="60" r="54"/><circle class="rp" cx="60" cy="60" r="54" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - sylPct)).toFixed(2)}" transform="rotate(-90 60 60)"/></svg><div class="mid"><b>${Math.round(sylPct * 100)}%</b><span>covered</span></div></div>
    <div>${bySub.length ? bySub.map((x) => `<div class="subrow"><span>${esc(x.sb.name)}</span><div class="track"><div style="width:${(x.done / x.n) * 100}%"></div></div><span class="n">${x.done}/${x.n}</span></div>`).join('') : empty('Tick topics in the To-do ▸ Syllabus tab to see progress here.')}</div></div></section>
<section class="card"><div class="row between"><h2 style="margin:0">Latest scores</h2><a href="#/tests" class="small">Tests ›</a></div>
  <div class="tiles" style="margin-top:10px">${latest.map((x) => `<div class="tile"><div class="v">${pct(x.p)}</div><div class="l">${x.l}</div></div>`).join('')}</div></section>`;

  $('#rev', root)?.addEventListener('click', () => (startReview(), (location.hash = '#/concepts')));
  root.addEventListener('click', (e) => {
    const pl = e.target.closest('[data-play]');
    if (pl) (startTask(pl.dataset.play), (location.hash = '#/timer'));
  });
  root.addEventListener('change', async (e) => {
    const tk = e.target.closest('[data-task]');
    if (!tk) return;
    try { await api('PUT', `/api/tasks/${tk.dataset.task}`, { done: tk.checked }); await refresh(); } catch (ex) { fail(ex); }
  });
}
