// Rule-based diagnosis of test scores, concepts and study time. Pure functions: everything comes in as arguments.
import { addDays, diffDays } from './dates.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
const pctOf = (t) => (t.total_marks && t.marks_obtained != null ? t.marks_obtained / t.total_marks : null);
export const tierOf = (t) => t.tier || (t.type === 'topic' ? 'topic' : t.type === 'subject' ? 'subject' : 'mock');
const hasCounts = (t) => t.correct != null && t.incorrect != null && t.total_questions > 0;

/** Per-test question metrics, oldest first. Only tests that have correct / wrong / total recorded. */
export function questionMetrics(tests) {
  return tests.filter(hasCounts).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map((t) => {
    const att = t.correct + t.incorrect;
    return {
      id: t.id, name: t.name, date: t.date, tier: tierOf(t),
      correct: t.correct, wrong: t.incorrect, unattempted: Math.max(0, t.total_questions - att), total: t.total_questions,
      accuracy: att ? t.correct / att : null, attemptRate: att / t.total_questions, scorePct: pctOf(t), negative: t.negative_marks ?? null,
    };
  });
}

/** Average of the latest `n` tests vs the `n` before them (n up to 3, at least 2), in percentage points. null when there are not enough tests. */
export function trend(tests, maxN = 3) {
  const s = tests.filter((t) => pctOf(t) != null).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const n = Math.min(maxN, Math.floor(s.length / 2)); // compare equal-sized windows; needs at least 2 tests in each
  if (n < 2) return null;
  const recent = avg(s.slice(0, n).map(pctOf)), before = avg(s.slice(n, n * 2).map(pctOf));
  return { recent, before, delta: (recent - before) * 100, n };
}

/** Whole-week study minutes for the last `weeks` weeks (oldest first); each entry { start, min }. `weekStartOf` maps a date to its Monday. */
export function weeklyMinutes(studyLog, today, weeks, weekStartOf) {
  const first = addDays(weekStartOf(today), -7 * (weeks - 1));
  const out = [...Array(weeks)].map((_, i) => ({ start: addDays(first, 7 * i), min: 0 }));
  for (const l of studyLog) {
    const i = Math.floor(diffDays(weekStartOf(l.date), first) / 7);
    if (i >= 0 && i < weeks) out[i].min += l.minutes;
  }
  return out;
}

/** Per subject: open concepts (by tag), minutes studied in the last `days`, syllabus coverage. */
export function subjectFocus({ subjects, topics, progress, concepts, studyLog, today, days = 30 }) {
  const since = addDays(today, -(days - 1));
  const studied = new Set(progress.filter((p) => p.studied).map((p) => p.topic_id));
  return subjects.map((s) => {
    const tops = topics.filter((t) => t.subject_id === s.id && !t.parent_id);
    const open = concepts.filter((c) => c.subject_id === s.id && c.status !== 'mastered');
    return {
      subject: s,
      minutes: sum(studyLog.filter((l) => l.subject_id === s.id && l.date >= since).map((l) => l.minutes)),
      openStruggle: open.filter((c) => c.kind === 'struggle').length,
      open: open.length,
      topics: tops.length,
      studied: tops.filter((t) => studied.has(t.id)).length,
    };
  });
}

/** The written diagnosis: [{ level: 'good'|'warn'|'bad'|'info', title, text }] plus the numbers behind it. */
export function diagnose({ tests, concepts, subjects, topics, progress, studyLog, today, examDate, weekStartOf }) {
  const out = [];
  const add = (level, title, text) => out.push({ level, title, text });
  const q = questionMetrics(tests);
  const recent = q.slice(-5);
  const m = {};

  if (recent.length) {
    const c = sum(recent.map((x) => x.correct)), w = sum(recent.map((x) => x.wrong)), tq = sum(recent.map((x) => x.total));
    m.accuracy = c + w ? c / (c + w) : null;
    m.attemptRate = (c + w) / tq;
    const negs = recent.filter((x) => x.negative != null);
    const grossLost = sum(negs.map((x) => x.negative));
    m.negativeTotal = grossLost;
    m.negShare = null;
    const tot = recent.map((x) => tests.find((t) => t.id === x.id)).filter((t) => t && t.negative_marks != null && t.marks_obtained != null);
    if (tot.length) m.negShare = sum(tot.map((t) => t.negative_marks)) / sum(tot.map((t) => t.marks_obtained + t.negative_marks));
    const label = `last ${recent.length} test${recent.length > 1 ? 's' : ''}`;
    const accP = Math.round(m.accuracy * 100), attP = Math.round(m.attemptRate * 100);
    if (m.accuracy >= 0.8 && m.attemptRate < 0.75) add('warn', 'Accurate but leaving marks', `Accuracy is ${accP}% but you only attempted ${attP}% of questions (${label}). Try attempting questions you are about 70% sure of — your accuracy can afford it.`);
    else if (m.accuracy < 0.6 && m.attemptRate >= 0.8) add('bad', 'Too many shots in the dark', `You attempted ${attP}% of questions at ${accP}% accuracy (${label}). Skipping the ones you cannot narrow down would protect your score.`);
    else if (m.accuracy >= 0.8 && m.attemptRate >= 0.75) add('good', 'Strong attempt quality', `${accP}% accuracy on ${attP}% attempted (${label}). Keep it up and push speed on the hard ones.`);
    else add('info', 'Accuracy and attempts', `${accP}% accuracy, ${attP}% attempted (${label}).`);
    if (m.negShare != null && m.negShare >= 0.1) add('bad', 'Negative marking is costly', `Negative marks took ${Math.round(m.negShare * 100)}% of what you earned in the ${label} (−${Math.round(grossLost * 100) / 100} marks).`);
  } else {
    add('info', 'Unlock test diagnostics', 'Add correct, wrong and total questions to your test scores to see accuracy, attempt rate and negative-marking analysis.');
  }

  for (const [tier, label] of [['mock', 'Full mocks'], ['weekly', 'Weekly quizzes'], ['topic', 'Topic tests'], ['subject', 'Subject tests']]) {
    const t = trend(tests.filter((x) => tierOf(x) === tier));
    if (!t) continue;
    if (t.delta >= 5) add('good', `${label} improving`, `Latest ${t.n} average ${Math.round(t.recent * 100)}%, up ${Math.round(t.delta)} points from ${Math.round(t.before * 100)}%.`);
    else if (t.delta <= -5) add('bad', `${label} slipping`, `Latest ${t.n} average ${Math.round(t.recent * 100)}%, down ${Math.round(-t.delta)} points from ${Math.round(t.before * 100)}%.`);
  }

  const focus = subjectFocus({ subjects, topics, progress, concepts, studyLog, today, days: 14 });
  const weakest = [...focus].sort((a, b) => b.openStruggle - a.openStruggle)[0];
  if (weakest && weakest.openStruggle >= 2) add('warn', `${weakest.subject.name}: concepts piling up`, `${weakest.openStruggle} open “struggled with” concepts and ${weakest.minutes ? Math.round(weakest.minutes / 60 * 10) / 10 + ' h' : 'no time'} logged in the last 14 days.`);
  const neglected = focus.filter((f) => f.open >= 1 && f.minutes === 0 && f !== weakest);
  if (neglected.length) add('warn', 'Untouched this fortnight', `${neglected.slice(0, 3).map((f) => f.subject.name).join(', ')}: open concepts but no study time in 14 days.`);

  const overdue = concepts.filter((c) => c.status !== 'mastered' && c.next_review < today).length;
  if (overdue >= 5) add('warn', 'Review backlog', `${overdue} concepts are overdue for review. A short session today stops them from being forgotten.`);

  const days = new Set(studyLog.filter((l) => l.date > addDays(today, -14)).map((l) => l.date)).size;
  if (studyLog.length) {
    if (days >= 12) add('good', 'Consistent', `You studied on ${days} of the last 14 days.`);
    else if (days <= 6) add('warn', 'Patchy week-to-week', `You studied on only ${days} of the last 14 days.`);
  }

  if (examDate && weekStartOf) {
    const weeks = Math.max(0, diffDays(examDate, today) / 7);
    const tops = topics.filter((t) => !t.parent_id);
    const doneTopics = progress.filter((p) => p.studied && tops.some((t) => t.id === p.topic_id)).length;
    const left = tops.length - doneTopics;
    if (weeks > 0 && left > 0) add('info', 'Syllabus pace', `${left} topics to cover in ${Math.round(weeks)} weeks: about ${Math.max(1, Math.ceil(left / weeks))} per week, leaving time for revision and mocks.`);
  }

  m.insights = out.length;
  return { insights: out, metrics: m };
}
