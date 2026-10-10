import { mount, D, esc, $, api, subName, topName, causeName, toast, fail, pct, num, mins, empty, dur } from './util.js';
import { summary, weekly, causeStats, bySubject } from '/shared/analytics.js';
import { buildPlan, BUCKETS } from '/shared/planner.js';
import { diffDays, shortDate } from '/shared/dates.js';
import { lineChart, barList } from './charts.js';
import { snippet, showMistake } from './mistakes.js';
import { focusReview } from './review.js';

let budget = null;
let showAll = false;

export function renderDashboard(host, refresh) {
  const root = mount(host);
  budget ??= D.settings.general.defaultBudgetMin || 90;
  const s = summary(D.mistakes, D.reviews, D.today);
  const wk = weekly(D.mistakes, D.reviews, D.tests, D.today, 12);
  const causes = causeStats(D.mistakes, D.causes);
  const subs = bySubject(D.subjects, D.topics, D.mistakes, D.tests).filter((r) => r.total).sort((a, b) => b.unresolved - a.unresolved);
  const todayTasks = D.tasks.filter((t) => t.date === D.today);
  const loggedToday = D.studyLog.filter((l) => l.date === D.today).reduce((a, l) => a + l.minutes, 0);
  const target = D.settings.general.dailyTargetMin;
  const exam = D.settings.general.examDate;

  const tile = (v, l, cls = '', tip = '') => `<div class="tile ${cls}" title="${esc(tip)}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  root.innerHTML = `
<div class="page-head"><div><h1>Dashboard</h1><p>${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${exam ? ` · ${diffDays(exam, D.today)} days to the exam` : ''}</p></div></div>
<div class="tiles">
  ${tile(s.total, 'Mistakes recorded')}
  ${tile(s.unresolved, 'Unresolved')}
  ${tile(s.dueToday, 'Reviews due today', s.dueToday ? 'warn' : '')}
  ${tile(s.overdue, 'Overdue reviews', s.overdue ? 'bad' : '')}
  ${tile(s.repeated, 'Repeated ≥ 2×', s.repeated ? 'warn' : '', 'Recurrences in later tests + failed reviews, at least two in total')}
  ${tile(s.mastered, 'Mastered', s.mastered ? 'good' : '', 'Mastery needs repeated independent successes, not a click')}
  ${tile(pct(s.completionRate), 'Review completion (7d)', '', 'Reviews recorded in the last 7 days ÷ (those + reviews still overdue). Blank until there is something to measure.')}
  ${tile(s.addedThisWeek, 'Added this week')}
</div>

<div class="grid g2">
<section class="card" aria-labelledby="planH">
  <div class="row between"><h2 id="planH" style="margin:0">What should I study today?</h2>
    <label class="row gap-s"><span class="muted small">Time available</span><input type="number" id="budget" min="5" step="5" value="${esc(budget)}" style="width:80px"> <span class="muted small">min</span></label></div>
  <div id="plan"></div>
</section>
<div>
  <section class="card"><div class="row between"><h2 style="margin:0">Today’s schedule</h2><a href="#/schedule" class="small">Open schedule ›</a></div>
    ${todayTasks.length ? todayTasks.map((t) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-task="${t.id}"${t.done ? ' checked' : ''} aria-label="Done"><span class="tt">${esc(t.title)} ${t.minutes ? `<span class="muted small">${dur(t.minutes)}</span>` : ''}</span></div>`).join('') : '<p class="muted small" style="margin:8px 0 0">No tasks planned for today. Add some in the Schedule.</p>'}
    <p class="small muted" style="margin:8px 0 0">Studied today: <b>${dur(loggedToday) || '0m'}</b>${target ? ` of ${dur(target)} target` : ''}</p>
    ${target ? `<div class="prog" style="margin-top:4px"><div style="width:${Math.min(100, (loggedToday / target) * 100)}%"></div></div>` : ''}
  </section>
  <section class="card"><h2>Mistakes per week</h2>
    ${wk.some((w) => w.mistakes) ? lineChart({ labels: wk.map((w) => w.week), series: [{ name: 'New mistakes', values: wk.map((w) => w.mistakes) }, { name: 'Recurrences', values: wk.map((w) => w.recurrences), color: 'var(--c2)' }], ariaLabel: 'Mistakes per week' }) : empty('Charts appear once you have logged mistakes.')}
    ${wk.some((w) => w.errorRate != null) ? '<p class="hint">Test error rates (per attempted question) are on the Analytics page.</p>' : ''}</section>
</div>
</div>

<div class="grid g2">
<section class="card"><h2>Where the mistakes come from</h2>
  ${causes.mostFrequent ? barList(causes.rows.filter((r) => r.count).sort((a, b) => b.count - a.count).map((r) => ({ label: r.cause.name, value: r.count, text: `${r.count} · ${pct(r.share)}` }))) : empty('No mistakes yet.')}
  ${causes.mostFrequent ? `<p class="small muted">Most frequent: <b>${esc(causes.mostFrequent.cause.name)}</b>${causes.mostCostly ? ` · Most costly (marks lost): <b>${esc(causes.mostCostly.cause.name)}</b> (${num(causes.mostCostly.marksLost)})` : ' · Add “marks lost” to see the most costly cause.'}</p>` : ''}
</section>
<section class="card"><h2>Subjects needing attention</h2>
  ${subs.length ? `<table><thead><tr><th>Subject</th><th class="num">Unresolved</th><th class="num">Mastered</th><th>Worst topics</th></tr></thead><tbody>${subs.slice(0, 7).map((r) => `<tr><td>${esc(r.subject.name)}</td><td class="num">${r.unresolved}</td><td class="num">${pct(r.masteryPct)}</td><td class="small">${r.problemTopics.map((p) => esc(p.topic?.name || '(no topic)')).join('; ')}</td></tr>`).join('')}</tbody></table>` : empty('No mistakes yet.')}
</section>
</div>`;

  const drawPlan = () => {
    const plan = buildPlan({ mistakes: D.mistakes, subjects: D.subjects, topics: D.topics, tests: D.tests, reviews: D.reviews, today: D.today, budgetMin: budget, settings: D.settings });
    const el = $('#plan', root);
    if (!plan.items.length && !plan.skipped.length) {
      el.innerHTML = empty(D.live.length ? 'Nothing to do today — everything is scheduled for later.' : 'Add your first mistake and a plan will appear here.');
      return;
    }
    let html = `<p class="muted small" style="margin:6px 0">Planned <b>${plan.usedMin}</b> of ${esc(budget)} min · ${plan.items.length} item(s)${plan.skipped.length ? ` · ${plan.skipped.length} more didn’t fit` : ''}</p>`;
    let last = 0;
    const CAP = 8;
    for (const it of showAll ? plan.items : plan.items.slice(0, CAP)) {
      if (it.bucket !== last) (html += `<div class="plan-group">${it.bucket}. ${BUCKETS[it.bucket]}</div>`), (last = it.bucket);
      html += it.mistake
        ? `<div class="plan-item"><div><a href="#" data-open="${it.mistake.id}">${esc(subName(it.mistake.subject_id))} › ${esc(topName(it.mistake.topic_id))}</a> <span class="muted">— ${esc(snippet(it.mistake).slice(0, 70))}</span><div class="muted small">${esc(it.why)}</div></div><div class="nowrap"><span class="badge">${it.minutes}m</span> <button class="btn small" data-rev="${it.mistake.id}">Review</button></div></div>`
        : `<div class="plan-item"><div><b>Study block: ${esc(it.topic.name)}</b> <span class="muted">(${esc(subName(it.topic.subject_id))})</span><div class="muted small">${esc(it.why)}</div></div><div class="nowrap"><span class="badge">${it.minutes}m</span> <button class="btn small" data-block="${it.topic.id}" data-min="${it.minutes}">Add to schedule</button></div></div>`;
    }
    if (plan.items.length > CAP) html += `<p style="margin:10px 0 0"><button class="btn small" id="togglePlan">${showAll ? 'Show fewer' : `Show all ${plan.items.length}`}</button></p>`;
    el.innerHTML = html + `<p class="hint" style="margin-top:12px">Order: overdue → repeated/high-impact → due today → maintenance. Minutes per item are configurable in Settings.</p>`;
  };
  drawPlan();

  $('#budget', root).addEventListener('input', (e) => {
    budget = Number(e.target.value) || null;
    drawPlan();
  });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('#togglePlan')) return ((showAll = !showAll), drawPlan());
    const open = e.target.closest('[data-open]');
    if (open) return (e.preventDefault(), showMistake(Number(open.dataset.open), refresh));
    const rev = e.target.closest('[data-rev]');
    if (rev) return (focusReview(Number(rev.dataset.rev)), (location.hash = '#/review'));
    const blk = e.target.closest('[data-block]');
    if (blk) {
      const t = D.topMap.get(Number(blk.dataset.block));
      try {
        await api('POST', '/api/tasks', { date: D.today, title: `Study: ${t.name}`, subject_id: t.subject_id, topic_id: t.id, kind: 'study', minutes: Number(blk.dataset.min) });
        toast('Added to today’s schedule');
        await refresh();
      } catch (ex) { fail(ex); }
    }
    const tk = e.target.closest('[data-task]');
    if (tk) {
      try {
        await api('PUT', `/api/tasks/${tk.dataset.task}`, { done: tk.checked });
        await refresh();
      } catch (ex) { fail(ex); }
    }
  });
  void mins; void causeName; void shortDate;
}
