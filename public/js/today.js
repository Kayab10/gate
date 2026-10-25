// Today: everything you need for the day on one screen, no forms.
import { mount, D, esc, $, api, subName, fail, empty, dur, num } from './util.js';
import { dueConcepts, startReview, KINDS } from './concepts.js';
import { startTask, runningInfo } from './timer.js';
import { insightCards } from './insights.js';
import { goalsCard, bindGoals } from './goals.js';
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
  const running = runningInfo();
  const studiedSet = new Set(D.progress.filter((p) => p.studied).map((p) => p.topic_id));
  const tops = D.topics.filter((t) => !t.parent_id);
  const sylPct = tops.length ? tops.filter((t) => studiedSet.has(t.id)).length / tops.length : 0;
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

  const bestStreak = (() => { let best = 0, cur = 0, prev = null; for (const d of [...byDay.keys()].sort()) { cur = prev && diffDays(d, prev) === 1 ? cur + 1 : 1; best = Math.max(best, cur); prev = d; } return best; })();
  const mocks = D.tests.filter((t) => (t.tier || (t.type === 'topic' || t.type === 'subject' ? t.type : 'mock')) === 'mock' && testStats(t).scorePct != null).sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id);
  const mock = mocks[0], mockPrev = mocks[1];
  const mockDelta = mock && mockPrev ? Math.round((mock.marks_obtained / mock.total_marks - mockPrev.marks_obtained / mockPrev.total_marks) * 100) : null;
  const studiedTopics = tops.filter((t) => studiedSet.has(t.id)).length;
  const goal = target || 0;
  const cards = insightCards();
  const stat = (label, value, sub, bar) => `<div><div class="sl">${label}</div><div class="sv">${value}</div>${bar != null ? `<div class="prog"><div style="width:${Math.min(100, Math.max(0, bar * 100))}%"></div></div>` : ''}<div class="ss">${sub}</div></div>`;

  root.innerHTML = `
<div class="page-head"><div><h1>Today</h1><p>${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
  <div class="row">${exam ? `<span class="countdown" title="Exam date: ${esc(exam)}"><b>${Math.max(0, diffDays(exam, D.today))}</b><span>days to go</span></span>` : ''}<a class="btn primary" href="#/timer">${running ? `⏱ Running · ${esc(running.text)}` : '▶ Start timer'}</a></div></div>

<div class="strip">
  ${stat('Syllabus covered', `${Math.round(sylPct * 100)}%`, `${studiedTopics} of ${tops.length} topics`, sylPct)}
  ${stat('Studied today', dur(loggedToday) || '0m', goal ? `of ${dur(goal)} goal` : 'set a goal in More', goal ? loggedToday / goal : null)}
  ${stat('Streak', `${streak} day${streak === 1 ? '' : 's'}`, `best ${bestStreak}`, null)}
  ${stat('Latest mock', mock ? `${num(mock.marks_obtained, 0)}<small> / ${num(mock.total_marks, 0)}</small>` : '—', mockDelta == null ? (mock ? 'first mock' : 'no mocks yet') : `${mockDelta >= 0 ? '+' : ''}${mockDelta} pts from previous`, null)}
</div>

<div class="dash">
<section class="card s8"><div class="row between"><h2 style="margin:0">Today's plan</h2><span class="muted small">${tasks.length ? `${doneN} of ${tasks.length} done` : ''}<a href="#/todo" style="margin-left:10px">Open ›</a></span></div>
  ${tasks.length ? `<div class="prog" style="margin:10px 0 6px"><div style="width:${(doneN / tasks.length) * 100}%"></div></div>` : ''}
  ${tasks.length ? '<div class="scrollbox" style="max-height:300px">' + tasks.map((t) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-task="${t.id}"${t.done ? ' checked' : ''} aria-label="Done"><span class="tt">${esc(t.title)}${t.subject_id ? `<div class="muted small">${esc(subName(t.subject_id))}</div>` : ''}</span>${t.done ? '' : `<button data-play="${t.id}" aria-label="Start timer">▶</button>`}</div>`).join('') + '</div>' : '<p class="muted small" style="margin:10px 0 0">Nothing planned for today. Add to-dos in the To-do tab.</p>'}</section>
<section class="card s4"><div class="row between"><h2 style="margin:0">Due for review</h2><a href="#/concepts" class="small">Concepts ›</a></div>
  ${due.length ? `<p class="muted small" style="margin:8px 0 0">${due.length} concept${due.length > 1 ? 's' : ''} due</p><div class="scrollbox" style="max-height:228px">` + due.map((m) => `<div class="plan-item"><div><b>${esc(m.title)}</b><div class="muted small">${esc(subName(m.subject_id))}</div></div><span class="badge">${KINDS[m.kind]?.[0] || ''}</span></div>`).join('') + `</div><div class="row" style="margin-top:10px"><button class="btn small" id="rev">Start review</button></div>` : `<div style="margin-top:10px">${empty(D.live.length ? 'All caught up.' : 'Add a concept you found hard.')}</div>`}</section>

${goalsCard(ws, { compact: true, cls: 's12' })}

<section class="card s12"><div class="row between"><h2 style="margin:0">Consistency</h2><span class="muted small">last 26 weeks</span></div>
  <div class="heatcard" style="margin-top:14px"><div class="heatwrap"><div class="heatdays" aria-hidden="true"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div><div class="heat" aria-label="Study consistency heat map">${cells.join('')}</div></div>
    <div class="heatstats"><div><b>${dur(weekMin) || '0m'}</b><span>this week</span></div><div><b>${dur(Math.round(last30 / 30)) || '0m'}</b><span>daily avg (30d)</span></div><div><b>${week.length ? `${week.filter((t) => t.done).length}/${week.length}` : '—'}</b><span>week's to-dos</span></div></div>
    <span class="legend2">Less <i></i><i style="background:var(--heat1)"></i><i style="background:var(--heat2)"></i><i style="background:var(--heat3)"></i><i style="background:var(--heat4)"></i> More</span></div></section>

<div class="s7">${cards.diag}</div><div class="s5">${cards.trendCard}</div>
<div class="s6">${cards.accCard}</div><div class="s6">${cards.hoursCard}</div>
<div class="s6">${cards.subjCard}</div><div class="s6">${cards.stackCard}</div>
</div>`;

  bindGoals(root, refresh);
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
