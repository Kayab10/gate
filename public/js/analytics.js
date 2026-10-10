import { mount, D, esc, $, subName, topName, pct, num, mins, empty } from './util.js';
import { bySubject, causeStats, weekly, masteryProgression, subjectWeekly, testStats, repeatCount } from '/shared/analytics.js';
import { isUnresolved } from '/shared/srs.js';
import { lineChart, barList, sparkBars, COLORS } from './charts.js';

let focus = '';

export function renderAnalytics(host) {
  const root = mount(host);
  const subs = bySubject(D.subjects, D.topics, D.mistakes, D.tests);
  const causes = causeStats(D.mistakes, D.causes);
  const weeks = weekly(D.mistakes, D.reviews, D.tests, D.today, 26);
  const hasData = D.live.length > 0;

  const focusSub = focus ? D.subMap.get(Number(focus)) : null;
  let focusHtml = '';
  if (focusSub) {
    const ms = D.live.filter((m) => m.subject_id === focusSub.id);
    const topics = D.topics.filter((t) => t.subject_id === focusSub.id && !t.parent_id);
    const rows = topics.map((t) => {
      const mine = ms.filter((m) => m.topic_id === t.id || D.topMap.get(m.subtopic_id)?.parent_id === t.id);
      const conf = mine.map((m) => m.confidence).filter((x) => x != null);
      return { t, n: mine.length, un: mine.filter(isUnresolved).length, rep: mine.reduce((a, m) => a + repeatCount(m), 0), conf: conf.length >= 3 ? conf.reduce((a, b) => a + b, 0) / conf.length : null };
    }).filter((r) => r.n).sort((a, b) => b.un - a.un || b.rep - a.rep);
    const noTopic = ms.filter((m) => !m.topic_id).length;
    const sw = subjectWeekly([focusSub], D.mistakes, weeks)[0];
    focusHtml = `<div class="card"><h2>${esc(focusSub.name)} — topics</h2>
      ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Topic</th><th class="num">Mistakes</th><th class="num">Unresolved</th><th class="num">Repeat events</th><th class="num">Avg confidence</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.t.name)}</td><td class="num">${r.n}</td><td class="num">${r.un}</td><td class="num">${r.rep}</td><td class="num">${num(r.conf)}</td></tr>`).join('')}</tbody></table></div>` : empty('No mistakes with a topic recorded for this subject.')}
      ${noTopic ? `<p class="hint">${noTopic} mistake(s) in this subject have no topic set.</p>` : ''}
      ${weeks.length > 1 && sw.series.some(Boolean) ? `<h3 style="margin-top:12px">New mistakes per week</h3>${lineChart({ labels: weeks.map((w) => w.week), series: [{ name: focusSub.name, values: sw.series }], ariaLabel: 'Weekly mistakes for subject' })}` : ''}</div>`;
  }

  root.innerHTML = `
<div class="page-head"><div><h1>Subject analytics</h1><p>Everything here is computed live from your stored records.</p></div>
  <label class="row gap-s"><span class="muted">Drill into</span><select id="focus"><option value="">— choose subject —</option>${D.subjects.map((s) => `<option value="${s.id}"${String(s.id) === String(focus) ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div>
${!hasData ? `<div class="empty">No mistakes recorded yet, so there is nothing to analyse. Log mistakes (and tests) and these views fill in automatically.</div>` : ''}
<div class="card"><h2>By subject</h2>
  <div class="tablewrap"><table><thead><tr><th>Subject</th><th class="num">Mistakes</th><th class="num">Unresolved</th><th class="num" title="Mistakes with 2+ recurrences/failed reviews">Repeated</th><th class="num">Mastered</th><th class="num" title="Needs ≥ 3 entries with a value">Avg confidence</th><th class="num" title="Needs ≥ 3 entries with a value">Avg time</th><th class="num" title="incorrect ÷ attempted, from your test breakdowns">Test error rate</th><th>Most problematic topics</th></tr></thead><tbody>${subs.map((r) => `<tr><td>${esc(r.subject.name)}</td><td class="num">${r.total}</td><td class="num">${r.unresolved}</td><td class="num">${r.repeats}</td><td class="num">${pct(r.masteryPct)}</td><td class="num">${num(r.avgConfidence)}</td><td class="num">${r.avgTimeSec != null ? mins(r.avgTimeSec) : '—'}</td><td class="num" title="${r.attempted} attempted">${pct(r.errorRate)}</td><td class="small">${r.problemTopics.map((p) => esc(p.topic?.name || '(no topic)')).join('; ') || '—'}</td></tr>`).join('')}</tbody></table></div>
  <p class="hint">“—” means not enough data (never a guess). Test error rate appears only for subjects with a breakdown entered in a test.</p></div>
${focusHtml}
<div class="grid g2">
<section class="card"><h2>Root causes — how often</h2>${causes.mostFrequent ? barList(causes.rows.filter((r) => r.count).sort((a, b) => b.count - a.count).map((r) => ({ label: r.cause.name, value: r.count, text: `${r.count} (${pct(r.share)})` }))) : empty('No data.')}</section>
<section class="card"><h2>Root causes — marks lost</h2>${causes.mostCostly ? barList(causes.rows.filter((r) => r.marksLost > 0).sort((a, b) => b.marksLost - a.marksLost).map((r) => ({ label: r.cause.name, value: r.marksLost, text: num(r.marksLost, 2), cls: 'warn' }))) : empty('Record “marks lost” on mistakes to see which causes cost the most.')}</section>
</div>
${causes.mostFrequent ? `<div class="card"><h2>Cause detail</h2><div class="tablewrap"><table><thead><tr><th>Cause</th><th class="num">Mistakes</th><th class="num">Unresolved</th><th class="num">Repeat events</th><th class="num">Marks lost</th></tr></thead><tbody>${causes.rows.filter((r) => r.count).map((r) => `<tr><td>${esc(r.cause.name)}</td><td class="num">${r.count}</td><td class="num">${r.unresolved}</td><td class="num">${r.repeats}</td><td class="num">${num(r.marksLost, 2)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}

<h2 style="margin-top:20px">Trends</h2>
${weeks.length < 2 ? empty('Trends need records from at least two different weeks.') : `
<div class="notice">A rising mistake count can simply mean you practised more. The <b>error rate</b> chart divides by questions attempted in tests, so use it to judge whether you are genuinely getting worse. Weeks without test data are left blank.</div>
<div class="grid g2">
  <section class="card"><h3>New mistakes & recurrences per week</h3>${lineChart({ labels: weeks.map((w) => w.week), series: [{ name: 'New mistakes', values: weeks.map((w) => w.mistakes) }, { name: 'Recurrences', values: weeks.map((w) => w.recurrences), color: 'var(--c2)' }] })}</section>
  <section class="card"><h3>Test error rate (incorrect ÷ attempted)</h3>${weeks.some((w) => w.errorRate != null) ? lineChart({ labels: weeks.map((w) => w.week), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, series: [{ name: 'Error rate', values: weeks.map((w) => w.errorRate), color: 'var(--c5)' }] }) + `<p class="hint">Attempted per week: ${weeks.filter((w) => w.attempted).map((w) => w.attempted).join(', ')}</p>` : empty('Enter correct/incorrect counts (or a breakdown) on your tests to enable this.')}</section>
  <section class="card"><h3>Successful review rate (independent ÷ reviews)</h3>${weeks.some((w) => w.successRate != null) ? lineChart({ labels: weeks.map((w) => w.week), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, series: [{ name: 'Success rate', values: weeks.map((w) => w.successRate), color: 'var(--c3)' }] }) : empty('No reviews recorded yet.')}</section>
  <section class="card"><h3>Mastery progression (currently mastered, cumulative)</h3>${weeks.some((w) => w.mistakes) ? lineChart({ labels: weeks.map((w) => w.week), series: [{ name: 'Mastered', values: masteryProgression(D.mistakes, weeks).map((x) => x.mastered), color: 'var(--good)' }, { name: 'Recorded', values: masteryProgression(D.mistakes, weeks).map((x) => x.total), color: 'var(--c7)' }] }) : empty('No data.')}</section>
</div>
<section class="card"><h3>Subject-wise new mistakes per week (last ${weeks.length} weeks)</h3><table><tbody>${subjectWeekly(D.subjects, D.mistakes, weeks).filter((r) => r.series.some(Boolean)).map((r) => `<tr><td>${esc(r.subject.name)}</td><td>${sparkBars(r.series, COLORS[D.subjects.indexOf(r.subject) % 8])}</td><td class="num muted">${r.series.reduce((a, b) => a + b, 0)}</td></tr>`).join('') || '<tr><td>No data</td></tr>'}</tbody></table></section>`}
<section class="card"><h3>Mock-test performance</h3>${mockTable()}</section>`;

  $('#focus', root).addEventListener('change', (e) => ((focus = e.target.value), renderAnalytics(host)));
  void subName; void topName;
}

function mockTable() {
  const tests = [...D.tests].filter((t) => testStats(t).scorePct != null || testStats(t).accuracyAttempted != null).sort((a, b) => a.date.localeCompare(b.date));
  if (!tests.length) return empty('Add tests with scores to see performance over time.');
  const providers = [...new Set(tests.map((t) => t.provider || 'Unspecified'))];
  return `${lineChart({ labels: tests.map((t) => t.date), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, series: providers.map((p, i) => ({ name: p, color: COLORS[i % 8], values: tests.map((t) => ((t.provider || 'Unspecified') === p ? testStats(t).scorePct ?? testStats(t).accuracyAttempted : null)) })) })}<div class="notice">Different providers calibrate difficulty differently — compare trends within a provider, not across them.</div>`;
}
