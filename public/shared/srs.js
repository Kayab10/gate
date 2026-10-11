// Spaced-repetition engine. Pure functions, no I/O.
//
// A mistake's schedule state is always *derived* by replaying its review events
// in chronological order (replay()). That makes edits safe: changing the original
// date, deleting a review, editing a review date or changing the interval settings
// simply re-derives a consistent state.
import { addDays } from './dates.js';

export const DEFAULT_SRS = {
  intervals: [1, 3, 7, 14, 30], // days, each measured from the previous review date
  failInterval: 1, // days until retry after a failed review / recurrence
  masteryStreak: 4, // consecutive independent successes needed for mastery
  maintenanceDays: 60, // spacing of optional maintenance reviews once mastered
};

export const OUTCOMES = {
  independent: { label: 'Solved independently', success: true },
  partial: { label: 'Partial reasoning', success: false },
  hint: { label: 'Needed a hint', success: false },
  failed: { label: 'Failed again', success: false },
  forgot: { label: 'Could not remember the concept', success: false },
  recurred: { label: 'Wrong again in a test/practice', success: false }, // not a review; a recurrence
};
export const REVIEW_OUTCOMES = ['independent', 'partial', 'hint', 'failed', 'forgot'];
const FAILURES = new Set(['failed', 'forgot', 'recurred']);

export const STATUS_LABELS = {
  new: 'New',
  due_first: 'Due for first review',
  in_progress: 'Review in progress',
  improving: 'Improving',
  mastered: 'Mastered',
  reopened: 'Reopened after recurrence',
};

export function normalizeSrs(cfg) {
  const c = { ...DEFAULT_SRS, ...(cfg || {}) };
  c.intervals = (Array.isArray(c.intervals) ? c.intervals : DEFAULT_SRS.intervals)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1);
  if (!c.intervals.length) c.intervals = [...DEFAULT_SRS.intervals];
  c.failInterval = Math.max(1, Number(c.failInterval) || 1);
  c.masteryStreak = Math.max(1, Math.round(Number(c.masteryStreak) || DEFAULT_SRS.masteryStreak));
  c.maintenanceDays = Math.max(1, Number(c.maintenanceDays) || DEFAULT_SRS.maintenanceDays);
  return c;
}

export function initialState(dateEncountered, cfg) {
  const c = normalizeSrs(cfg);
  return {
    status: 'new',
    stage: 0,
    streak: 0,
    fail_count: 0,
    recurrence_count: 0,
    reopen_count: 0,
    review_count: 0,
    success_count: 0,
    last_review: null,
    last_success: null,
    mastered_at: null,
    next_review: addDays(dateEncountered, c.intervals[0]),
  };
}

/** Apply one event {outcome, date} to a state, returning the new state. */
export function applyEvent(state, ev, cfg) {
  const c = normalizeSrs(cfg);
  const iv = c.intervals;
  const s = { ...state };
  const { outcome, date } = ev;
  const wasMastered = s.status === 'mastered';

  if (FAILURES.has(outcome)) {
    if (outcome === 'recurred') s.recurrence_count++;
    else {
      s.fail_count++;
      s.review_count++;
      s.last_review = date;
    }
    s.stage = 0;
    s.streak = 0;
    if (wasMastered || s.status === 'reopened') {
      if (wasMastered) s.reopen_count++;
      s.status = 'reopened';
    } else s.status = 'in_progress';
    s.mastered_at = null;
    s.next_review = addDays(date, c.failInterval);
    return s;
  }

  // Non-failure review outcomes.
  // A second review on the same day never advances the schedule (success can't be farmed).
  if (s.last_review === date) return s;
  s.review_count++;
  s.last_review = date;

  if (outcome === 'independent') {
    s.streak++;
    s.success_count++;
    s.last_success = date;
    s.stage = Math.min(s.stage + 1, iv.length);
    if (s.streak >= c.masteryStreak) {
      s.status = 'mastered';
      s.mastered_at = s.mastered_at || date;
      s.next_review = addDays(date, c.maintenanceDays);
    } else {
      s.status = s.streak >= 2 ? 'improving' : 'in_progress';
      s.mastered_at = null;
      s.next_review = addDays(date, iv[Math.min(s.stage, iv.length - 1)]);
    }
    return s;
  }

  // partial / hint: not independent, so the streak resets and mastery is withdrawn.
  s.streak = 0;
  s.mastered_at = null;
  if (outcome === 'hint') s.stage = Math.max(0, Math.min(s.stage, iv.length) - 1);
  else s.stage = Math.min(s.stage, iv.length);
  s.status = wasMastered ? 'improving' : s.status === 'reopened' ? 'reopened' : 'in_progress';
  // repeat the interval that was just used (for partial) or step one back (for hint)
  const idx = outcome === 'hint' ? s.stage : Math.max(0, s.stage - 1);
  s.next_review = addDays(date, iv[Math.min(idx, iv.length - 1)]);
  return s;
}

function sortEvents(events) {
  return [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id || 0) - (b.id || 0)));
}

export function replay(dateEncountered, events, cfg) {
  let s = initialState(dateEncountered, cfg);
  for (const ev of sortEvents(events)) {
    // events dated before the mistake existed are ignored for scheduling purposes
    if (ev.date < dateEncountered) continue;
    s = applyEvent(s, ev, cfg);
  }
  return s;
}

/** What would the next review date be for each outcome if reviewed on `date`? */
export function previewOutcomes(state, date, cfg) {
  const out = {};
  for (const o of REVIEW_OUTCOMES) {
    const n = applyEvent(state, { outcome: o, date }, cfg);
    out[o] = { next_review: n.next_review, status: n.status, streak: n.streak };
  }
  return out;
}

/** Status shown to the user, deriving "Due for first review" from a new item that is due. */
export function displayStatus(m, today) {
  if (m.status === 'new' && m.next_review <= today) return 'due_first';
  return m.status;
}
export const isUnresolved = (m) => !m.archived && m.status !== 'mastered';
