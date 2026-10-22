// Today: everything you need for the day on one screen, no forms.
import { mount, D, esc, $, api, subName, topName, fail, empty, dur, pct } from './util.js';
import { ring } from './charts.js';
import { dueConcepts, startReview, KINDS } from './concepts.js';
import { startTask, runningInfo } from './timer.js';
import { TIERS } from './tests.js';
import { testStats } from '/shared/analytics.js';
import { diffDays, weekStart, addDays } from '/shared/dates.js';

const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

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

  root.innerHTML = `
<section class="hero">
  <div><div class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    <h1>${esc(greeting())}${D.user?.name ? ', ' + esc(D.user.name.split(' ')[0]) : ''}</h1>
    <p>${tasks.length ? `${doneN} of ${tasks.length} to-dos done` : 'Nothing planned yet'} · ${due.length ? `${due.length} concept${due.length > 1 ? 's' : ''} to review` : 'no reviews due'}</p>
    <div class="chipline"><span class="pillstat"><b>${week.filter((t) => t.done).length}/${week.length}</b> this week</span><span class="pillstat"><b>${D.live.length}</b> concepts</span></div></div>
  <div class="hero-side">
    <div class="ringbox">${ring(loggedToday / (target || 240))}<div class="mid"><b>${dur(loggedToday) || '0m'}</b><span>${target ? `of ${dur(target)}` : 'studied today'}</span></div></div>
    ${exam ? `<div class="daycount" title="Exam date: ${esc(exam)}"><b>${Math.max(0, diffDays(exam, D.today))}</b><span>days to go</span></div>` : ''}
  </div>
</section>
<div class="actions">
  <a class="btn primary" href="#/timer">${running ? `⏱ Timer running · ${esc(running.text)}` : '▶ Start timer'}</a>
  ${due.length ? '<button class="btn" id="rev">Review concepts</button>' : ''}
  <a class="btn" href="#/todo">＋ To-do</a>
</div>
<div class="grid g2">
<section class="card"><div class="row between"><h2 style="margin:0">To-do today</h2><a href="#/todo" class="small">Open ›</a></div>
  ${tasks.length ? tasks.map((t) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-task="${t.id}"${t.done ? ' checked' : ''} aria-label="Done"><span class="tt">${esc(t.title)}${t.subject_id ? `<div class="muted small">${esc(subName(t.subject_id))}</div>` : ''}</span>${t.done ? '' : `<button data-play="${t.id}" aria-label="Start timer">▶</button>`}</div>`).join('') : '<p class="muted small" style="margin:8px 0 0">Nothing planned. Add to-dos in the To-do tab.</p>'}</section>
<section class="card"><div class="row between"><h2 style="margin:0">Due for review</h2><a href="#/concepts" class="small">Concepts ›</a></div>
  ${due.length ? due.slice(0, 6).map((m) => `<div class="plan-item"><div><b>${esc(m.title)}</b><div class="muted small">${esc(subName(m.subject_id))}${m.topic_id ? ' › ' + esc(topName(m.topic_id)) : ''}</div></div><span class="badge">${KINDS[m.kind]?.[0] || ''}</span></div>`).join('') + (due.length > 6 ? `<p class="muted small">…and ${due.length - 6} more</p>` : '') : empty(D.live.length ? 'Nothing due — all caught up.' : 'Add a concept you found hard and it will show up here.')}</section>
</div>
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
