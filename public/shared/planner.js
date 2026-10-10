// "What should I study today?" — builds a ranked list and fits it into a time budget.
import { priorityScore, effectiveImportance } from './priority.js';
import { isUnresolved } from './srs.js';
import { diffDays } from './dates.js';

export const DEFAULT_PLANNER = {
  minutesEasy: 3,
  minutesMedium: 5,
  minutesHard: 8,
  minutesDefault: 5,
  maintenanceMax: 5,
  aheadDays: 3, // repeated/high-impact items due within this many days may be pulled forward
};

export const BUCKETS = {
  1: 'Overdue reviews',
  2: 'Repeated or high-impact errors',
  3: 'Scheduled reviews due today',
  4: 'Optional maintenance (mastered)',
};

export function normalizePlanner(cfg) {
  const c = { ...DEFAULT_PLANNER };
  for (const k of Object.keys(DEFAULT_PLANNER)) {
    const v = Number(cfg?.[k]);
    if (cfg && cfg[k] !== undefined && cfg[k] !== '' && Number.isFinite(v) && v >= 0) c[k] = v;
  }
  return c;
}

export function reviewMinutes(m, cfg) {
  return m.difficulty === 'easy' ? cfg.minutesEasy : m.difficulty === 'hard' ? cfg.minutesHard : m.difficulty === 'medium' ? cfg.minutesMedium : cfg.minutesDefault;
}

export function scoreMistakes(mistakes, subjects, topics, today, priorityCfg) {
  const out = new Map();
  for (const m of mistakes) {
    const subject = subjects.find((s) => s.id === m.subject_id);
    const topic = topics.find((t) => t.id === (m.topic_id ?? -1));
    out.set(m.id, priorityScore(m, { today, importance: effectiveImportance(topic, subject) }, priorityCfg));
  }
  return out;
}

export function buildPlan({ mistakes, subjects, topics, tests, reviews, today, budgetMin, settings }) {
  const pc = normalizePlanner(settings?.planner);
  const live = mistakes.filter((m) => !m.archived);
  const scores = scoreMistakes(live, subjects, topics, today, settings?.priority);
  const sc = (m) => scores.get(m.id).score;
  const byScore = (a, b) => sc(b) - sc(a) || a.next_review.localeCompare(b.next_review);
  const used = new Set();
  const items = [];
  const push = (bucket, m, why, extra = {}) => {
    used.add(m.id);
    items.push({ bucket, mistake: m, minutes: reviewMinutes(m, pc), why, score: sc(m), ...extra });
  };

  const unresolved = live.filter(isUnresolved);
  for (const m of unresolved.filter((x) => x.next_review < today).sort(byScore))
    push(1, m, /overdue/.test(scores.get(m.id).reason) ? scores.get(m.id).reason : `${diffDays(today, m.next_review)} day(s) overdue · ${scores.get(m.id).reason}`);

  for (const m of unresolved
    .filter((x) => !used.has(x.id) && diffDays(x.next_review, today) <= pc.aheadDays)
    .filter((x) => x.recurrence_count > 0 || x.fail_count >= 2 || scores.get(x.id).high)
    .sort(byScore))
    push(2, m, `${m.recurrence_count > 0 ? 'Recurred' : m.fail_count >= 2 ? 'Failed repeatedly' : 'High priority'} · ${scores.get(m.id).reason}`);

  for (const m of unresolved.filter((x) => !used.has(x.id) && x.next_review === today).sort(byScore)) push(3, m, `Scheduled for today · ${scores.get(m.id).reason}`);

  const maint = live
    .filter((m) => m.status === 'mastered' && m.next_review <= today)
    .sort((a, b) => a.next_review.localeCompare(b.next_review))
    .slice(0, pc.maintenanceMax);
  for (const m of maint) push(4, m, 'Mastered — optional spot-check to keep it fresh');

  // fit the budget: take items in rank order, skip any that no longer fit, keep filling
  const chosen = [];
  const skipped = [];
  let usedMin = 0;
  const budget = budgetMin == null || budgetMin === '' ? Infinity : Number(budgetMin);
  for (const it of items) {
    if (usedMin + it.minutes <= budget) (chosen.push(it), (usedMin += it.minutes));
    else skipped.push(it);
  }
  return { items: chosen, skipped, usedMin, budget, scores };
}
