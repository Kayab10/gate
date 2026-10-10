// Deterministic, explainable priority score. Every point comes from a named component.
import { diffDays } from './dates.js';

export const DEFAULT_PRIORITY = {
  recurrence: 15, // per time the same mistake recurred in a test/practice
  failedReview: 10, // per failed review
  severity: 6, // per severity level (1-5)
  marksLost: 5, // per mark lost
  overdueDay: 3, // per day overdue
  overdueCap: 14,
  sinceSuccessDay: 0.3, // per day since last independent success (or since first mistake)
  sinceCap: 60,
  importance: 4, // per importance level above/below 3 (your own manual setting, default neutral)
  overconfidence: 5, // per confidence level above 3 on a wrong answer
  masteredFactor: 0.2, // multiplier for mastered items
  highImpactThreshold: 60, // score at/above which an item counts as "high impact"
};

export function normalizePriority(cfg) {
  const c = { ...DEFAULT_PRIORITY };
  for (const k of Object.keys(DEFAULT_PRIORITY)) {
    const v = Number(cfg?.[k]);
    if (cfg && cfg[k] !== undefined && cfg[k] !== '' && Number.isFinite(v)) c[k] = v;
  }
  return c;
}

/** effective importance: topic setting if changed from the neutral 3, else the subject's */
export function effectiveImportance(topic, subject) {
  if (topic && topic.importance && topic.importance !== 3) return topic.importance;
  return subject?.importance || 3;
}

export function priorityScore(m, ctx, cfgIn) {
  const cfg = normalizePriority(cfgIn);
  const { today } = ctx;
  const parts = [];
  const add = (key, label, points) => {
    if (points) parts.push({ key, label, points: Math.round(points * 10) / 10 });
  };
  add('recurrence', `Recurred ${m.recurrence_count}×`, (m.recurrence_count || 0) * cfg.recurrence);
  add('failedReview', `${m.fail_count} failed review(s)`, (m.fail_count || 0) * cfg.failedReview);
  add('severity', `Severity ${m.severity || 3}`, (m.severity || 3) * cfg.severity);
  add('marksLost', `${m.marks_lost || 0} mark(s) lost`, (m.marks_lost || 0) * cfg.marksLost);
  if (m.status !== 'mastered' && m.next_review < today) {
    const d = Math.min(diffDays(today, m.next_review), cfg.overdueCap);
    add('overdue', `${diffDays(today, m.next_review)} day(s) overdue`, d * cfg.overdueDay);
  }
  const since = diffDays(today, m.last_success || m.date_encountered);
  if (since > 0) {
    add(
      'since',
      m.last_success ? `${since}d since last success` : `${since}d since first mistake`,
      Math.min(since, cfg.sinceCap) * cfg.sinceSuccessDay,
    );
  }
  const imp = ctx.importance || 3;
  add('importance', `Importance ${imp}/5 (set by you)`, (imp - 3) * cfg.importance);
  if (m.confidence && m.confidence > 3) {
    add('overconfidence', `Confidently wrong (confidence ${m.confidence}/5)`, (m.confidence - 3) * cfg.overconfidence);
  }
  let score = parts.reduce((a, p) => a + p.points, 0);
  if (m.status === 'mastered') {
    const adj = score * cfg.masteredFactor - score;
    parts.push({ key: 'mastered', label: `Mastered (×${cfg.masteredFactor})`, points: Math.round(adj * 10) / 10 });
    score *= cfg.masteredFactor;
  }
  score = Math.max(0, Math.round(score * 10) / 10);
  const reason = [...parts]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 3)
    .map((p) => p.label)
    .join(' · ');
  return { score, parts, reason, high: score >= cfg.highImpactThreshold };
}
