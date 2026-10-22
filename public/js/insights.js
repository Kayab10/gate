// Dashboard diagnostics: written findings plus the charts behind them.
import { D, esc, dur, pct, empty } from './util.js';
import { lineChart, columnChart, stackRows, barList, COLORS } from './charts.js';
import { diagnose, questionMetrics, weeklyMinutes, subjectFocus, tierOf } from '/shared/diagnostics.js';
import { testStats } from '/shared/analytics.js';
import { weekStart, shortDate } from '/shared/dates.js';

const TIER_LABEL = { weekly: 'Weekly quiz', topic: 'Topic-wise', subject: 'Subject-wise', mock: 'Full mock' };
const TIER_COLOR = { weekly: COLORS[0], topic: COLORS[2], subject: COLORS[1], mock: COLORS[3] };

export function insightCards() {
  const scored = [...D.tests].filter((t) => testStats(t).scorePct != null).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const q = questionMetrics(D.tests);
  const d = diagnose({ tests: D.tests, concepts: D.live, subjects: D.subjects, topics: D.topics, progress: D.progress, studyLog: D.studyLog, today: D.today, examDate: D.settings.general.examDate, weekStartOf: weekStart });
  const m = d.metrics;
  const tiers = Object.keys(TIER_LABEL).filter((k) => scored.some((t) => tierOf(t) === k));
  const latestMock = [...scored].reverse().find((t) => tierOf(t) === 'mock');

  const metrics = `<div class="metrics">
    <div><b>${m.accuracy != null ? pct(m.accuracy) : '—'}</b><span>accuracy (attempted)</span></div>
    <div><b>${m.attemptRate != null ? pct(m.attemptRate) : '—'}</b><span>attempt rate</span></div>
    <div><b>${m.negShare != null ? pct(m.negShare) : '—'}</b><span>lost to negatives</span></div>
    <div><b>${latestMock ? pct(testStats(latestMock).scorePct) : '—'}</b><span>latest full mock</span></div></div>`;

  const diag = `<section class="card"><div class="row between"><h2 style="margin:0">Diagnosis</h2><span class="muted small">from your tests, concepts and study log</span></div>
    <div style="margin-top:14px">${metrics}${d.insights.map((i) => `<div class="insight ${i.level}"><span class="dot"></span><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div></div>`).join('')}</div></section>`;

  const trendCard = `<section class="card"><h2>Score trend</h2>${scored.length >= 2
    ? lineChart({ labels: scored.map((t) => t.date), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, ariaLabel: 'Score percentage by test', series: tiers.map((k) => ({ name: TIER_LABEL[k], color: TIER_COLOR[k], values: scored.map((t) => (tierOf(t) === k ? testStats(t).scorePct : null)) })) })
    : empty('Two scored tests are needed for a trend.')}</section>`;

  const accCard = `<section class="card"><h2>Accuracy vs attempt rate</h2>${q.length >= 2
    ? lineChart({ labels: q.map((x) => x.date), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, ariaLabel: 'Accuracy, attempt rate and score by test', series: [
      { name: 'Score', color: COLORS[3], values: q.map((x) => x.scorePct) },
      { name: 'Accuracy', color: COLORS[2], values: q.map((x) => x.accuracy) },
      { name: 'Attempt rate', color: COLORS[1], values: q.map((x) => x.attemptRate) }] })
    : empty('Record correct / wrong / total questions on two tests to see this.')}
    <p class="hint">High accuracy with low attempt rate means unused marks; low accuracy with high attempt rate means costly guessing.</p></section>`;

  const weeks = weeklyMinutes(D.studyLog, D.today, 12, weekStart);
  const tgt = D.settings.general.dailyTargetMin;
  const hoursCard = `<section class="card"><h2>Study hours per week</h2>${weeks.some((w) => w.min)
    ? columnChart(weeks.map((w) => ({ label: shortDate(w.start), value: Math.round((w.min / 60) * 10) / 10, title: `Week of ${w.start}: ${dur(w.min)}` })), { line: tgt ? Math.round(((tgt * 7) / 60) * 10) / 10 : null, fmt: (v) => `${v}h`, ariaLabel: 'Study hours per week' })
    : empty('Nothing logged yet — use the Timer.')}</section>`;

  const focus = subjectFocus({ subjects: D.subjects, topics: D.topics, progress: D.progress, concepts: D.live, studyLog: D.studyLog, today: D.today, days: 30 });
  const byTime = focus.filter((f) => f.minutes).sort((a, b) => b.minutes - a.minutes).slice(0, 7);
  const byStruggle = focus.filter((f) => f.openStruggle).sort((a, b) => b.openStruggle - a.openStruggle).slice(0, 7);
  const subjCard = `<section class="card"><h2>Time vs trouble spots</h2>
    <h3 class="muted small" style="font-weight:600;margin:0 0 4px">Study time, last 30 days</h3>${byTime.length ? barList(byTime.map((f) => ({ label: f.subject.name, value: f.minutes, text: dur(f.minutes) }))) : empty('No time logged against a subject.')}
    <h3 class="muted small" style="font-weight:600;margin:14px 0 4px">Open “struggled with” concepts</h3>${byStruggle.length ? barList(byStruggle.map((f) => ({ label: f.subject.name, value: f.openStruggle, text: String(f.openStruggle), cls: 'warn' }))) : empty('No open struggle concepts.')}</section>`;

  const lastQ = q.slice(-8);
  const stackCard = `<section class="card"><h2>Where the questions went</h2>${lastQ.length
    ? stackRows(lastQ.map((x) => ({ label: x.name, right: x.scorePct != null ? pct(x.scorePct) : '', parts: [{ value: x.correct, cls: 'ok', title: `${x.correct} correct` }, { value: x.wrong, cls: 'no', title: `${x.wrong} wrong` }, { value: x.unattempted, cls: 'skip', title: `${x.unattempted} unattempted` }] })))
      + '<div class="legend"><span><i class="sw" style="background:var(--good)"></i>Correct</span><span><i class="sw" style="background:var(--bad)"></i>Wrong</span><span><i class="sw" style="background:var(--faint)"></i>Unattempted</span></div>'
    : empty('Add question counts to your tests.')}</section>`;

  return { diag, trendCard, accCard, hoursCard, subjCard, stackCard };
}
