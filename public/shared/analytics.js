// Analytics derived purely from stored records. No fabricated data: every function
// returns null / empty arrays when the underlying data is missing.
import { addDays, diffDays, weekStart } from './dates.js';
import { isUnresolved } from './srs.js';

const active = (ms) => ms.filter((m) => !m.archived);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => (a.length ? sum(a) / a.length : null);

export const repeatCount = (m) => (m.recurrence_count || 0) + (m.fail_count || 0);

export function summary(mistakes, reviews, today) {
  const ms = active(mistakes);
  const unresolved = ms.filter(isUnresolved);
  const wk = weekStart(today);
  const last7 = reviews.filter((r) => r.outcome !== 'recurred' && diffDays(today, r.date) >= 0 && diffDays(today, r.date) < 7);
  const overdue = unresolved.filter((m) => m.next_review < today).length;
  return {
    total: ms.length,
    unresolved: unresolved.length,
    dueToday: unresolved.filter((m) => m.next_review === today).length,
    overdue,
    repeated: ms.filter((m) => repeatCount(m) >= 2).length,
    mastered: ms.filter((m) => m.status === 'mastered').length,
    // reviews done in the last 7 days / (those + items still overdue). null if nothing to measure.
    completionRate: last7.length + overdue ? last7.length / (last7.length + overdue) : null,
    addedThisWeek: ms.filter((m) => m.date_encountered >= wk && m.date_encountered <= addDays(wk, 6)).length,
  };
}

export function testStats(t) {
  const attempted = (Number(t.correct) || 0) + (Number(t.incorrect) || 0);
  const hasCounts = t.correct != null && t.incorrect != null;
  return {
    scorePct: t.total_marks && t.marks_obtained != null ? t.marks_obtained / t.total_marks : null,
    // accuracy among ALL questions requires the total question count
    accuracyAll: t.total_questions && t.correct != null ? t.correct / t.total_questions : null,
    // accuracy among attempted questions
    accuracyAttempted: hasCounts && attempted ? t.correct / attempted : null,
    attempted: hasCounts ? attempted : null,
    attemptRate: hasCounts && t.total_questions ? attempted / t.total_questions : null,
    unattempted: t.unattempted ?? (t.total_questions && hasCounts ? t.total_questions - attempted : null),
  };
}

export function causeStats(mistakes, causes) {
  const ms = active(mistakes);
  const rows = causes.map((c) => {
    const mine = ms.filter((m) => m.cause_primary === c.id);
    return {
      cause: c,
      count: mine.length,
      marksLost: sum(mine.map((m) => m.marks_lost || 0)),
      share: ms.length ? mine.length / ms.length : 0,
      unresolved: mine.filter(isUnresolved).length,
      repeats: sum(mine.map(repeatCount)),
    };
  });
  const used = rows.filter((r) => r.count);
  return {
    rows,
    mostFrequent: used.length ? [...used].sort((a, b) => b.count - a.count)[0] : null,
    mostCostly: used.some((r) => r.marksLost > 0) ? [...used].sort((a, b) => b.marksLost - a.marksLost)[0] : null,
  };
}

export function bySubject(subjects, topics, mistakes, tests) {
  const ms = active(mistakes);
  return subjects.map((s) => {
    const mine = ms.filter((m) => m.subject_id === s.id);
    const conf = mine.map((m) => m.confidence).filter((x) => x != null);
    const time = mine.map((m) => m.time_spent_sec).filter((x) => x != null);
    const perTopic = {};
    for (const m of mine.filter(isUnresolved)) perTopic[m.topic_id ?? 0] = (perTopic[m.topic_id ?? 0] || 0) + 1 + repeatCount(m);
    const problem = Object.entries(perTopic)
      .map(([id, n]) => ({ topic: topics.find((t) => t.id === Number(id)) || null, score: n }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    let attempted = 0,
      incorrect = 0;
    for (const t of tests)
      for (const b of t.breakdown || []) if (b.subject_id === s.id) {
        attempted += (Number(b.correct) || 0) + (Number(b.incorrect) || 0);
        incorrect += Number(b.incorrect) || 0;
      }
    return {
      subject: s,
      total: mine.length,
      unresolved: mine.filter(isUnresolved).length,
      repeats: mine.filter((m) => repeatCount(m) >= 2).length,
      masteryPct: mine.length ? mine.filter((m) => m.status === 'mastered').length / mine.length : null,
      avgConfidence: conf.length >= 3 ? avg(conf) : null,
      avgTimeSec: time.length >= 3 ? avg(time) : null,
      problemTopics: problem,
      attempted,
      errorRate: attempted ? incorrect / attempted : null,
    };
  });
}

/** Weekly series between the first and last event week (inclusive). */
export function weekly(mistakes, reviews, tests, today, maxWeeks = 26) {
  const ms = active(mistakes);
  const dates = [...ms.map((m) => m.date_encountered), ...reviews.map((r) => r.date), ...tests.map((t) => t.date)];
  if (!dates.length) return [];
  const first = weekStart(dates.reduce((a, b) => (a < b ? a : b)));
  const last = weekStart(today);
  const out = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    out.push({ week: w, mistakes: 0, recurrences: 0, reviews: 0, successes: 0, attempted: 0, incorrect: 0 });
  }
  const idx = (d) => out.find((o) => o.week === weekStart(d));
  for (const m of ms) idx(m.date_encountered) && idx(m.date_encountered).mistakes++;
  for (const r of reviews) {
    const o = idx(r.date);
    if (!o) continue;
    if (r.outcome === 'recurred') o.recurrences++;
    else {
      o.reviews++;
      if (r.outcome === 'independent') o.successes++;
    }
  }
  for (const t of tests) {
    const o = idx(t.date);
    if (!o) continue;
    for (const b of t.breakdown || []) {
      o.attempted += (Number(b.correct) || 0) + (Number(b.incorrect) || 0);
      o.incorrect += Number(b.incorrect) || 0;
    }
    if (!(t.breakdown || []).length && t.correct != null && t.incorrect != null) {
      o.attempted += t.correct + t.incorrect;
      o.incorrect += t.incorrect;
    }
  }
  for (const o of out) {
    o.successRate = o.reviews ? o.successes / o.reviews : null;
    // error rate uses attempted questions as the denominator, only when tests supply them
    o.errorRate = o.attempted ? o.incorrect / o.attempted : null;
  }
  return out.slice(-maxWeeks);
}

export function masteryProgression(mistakes, weeks) {
  const ms = active(mistakes);
  return weeks.map((w) => ({
    week: w.week,
    mastered: ms.filter((m) => m.mastered_at && m.mastered_at <= addDays(w.week, 6)).length,
    total: ms.filter((m) => m.date_encountered <= addDays(w.week, 6)).length,
  }));
}

export function subjectWeekly(subjects, mistakes, weeks) {
  const ms = active(mistakes);
  return subjects.map((s) => ({
    subject: s,
    series: weeks.map((w) => ms.filter((m) => m.subject_id === s.id && m.date_encountered >= w.week && m.date_encountered <= addDays(w.week, 6)).length),
  }));
}
