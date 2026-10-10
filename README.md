# GATE 2027 Mistake Tracker

A mistake tracker, spaced-review scheduler, test log and study planner. It is a **PWA** (installable on your phone) that runs on
**Vercel** with data in **Supabase Postgres**, so your phone and laptop always show the same data.
One password, entered once per device (stays signed in for a year). After login you choose **what you are studying** (a *stream*); each stream has its own syllabus, mistakes, tests and schedule. It ships with **Mechanical Engineering (ME)**, seeded from the GATE 2027 ME syllabus; more streams can be added from the chooser.

- **Put it online and install it:** see [DEPLOY.md](DEPLOY.md).
- **Try it locally first:** `node server.js` → http://localhost:5050 (an in-process Postgres in `data/pglite`, no accounts needed). Node 22+.

## Pages

| Page | What it does |
|---|---|
| Dashboard | Summary metrics, **What should I study today?** (fits your time budget), today's schedule, trends |
| Add mistake | Only subject + primary cause required. `Ctrl+Enter` = save & add another (keeps subject/test context). `N` anywhere = quick-add popup. Paste a screenshot with Ctrl+V |
| All mistakes | Search, 12+ filters, saved filters, sorting, bulk actions, detail view with priority breakdown and review history |
| Review queue | Overdue / due / upcoming. Solution hidden until revealed; keys `Space` (reveal) and `1`–`5` (outcome) |
| Tests & mocks | Scores, accuracy (attempted vs all), per-subject breakdown, linked mistakes, mock-review filters, quick "add mistake from this test" |
| Schedule & tracker | Weekly planner (repeat weekly, missed-task rollover), study-time log + consistency calendar, syllabus checklist (studied / revisions / PYQs) |
| Subject analytics | Per-subject and root-cause analysis, weekly trends, error rate per attempted question |
| Settings | Exam date, review intervals, priority weights, mastery thresholds, plan time estimates, syllabus and root-cause editors |

## How the algorithms work

**Review scheduling** (`shared/srs.js`). Default intervals 1, 3, 7, 14, 30 days, each measured from the *actual date of the previous review* (so overdue reviews don't compress the spacing). A mistake's state is always **re-derived by replaying its review events**, which is why editing dates, undoing a review or changing intervals can never leave it inconsistent.
- *Solved independently* → next interval; streak +1. **Mastered after N consecutive independent solves** (default 4) — then only maintenance spot-checks every 60 days.
- *Partial* → repeat the same interval, streak reset. *Hint* → one step back, streak reset.
- *Failed / couldn't remember concept* → back to step 0, retry after 1 day. A mastered item becomes **Reopened**.
- "Got it wrong again" in a later test is recorded as a *recurrence* (same effect, counted separately).
- Several reviews on one day never advance the schedule twice.

**Priority score** (`shared/priority.js`) is a plain sum of named parts: recurrences, failed reviews, severity, marks lost, days overdue, days since last success, your own importance rating (neutral at 3), and confidently-wrong answers. Mastered items are scaled down. Hover a score or open the detail view to see every line. Weights are in Settings. Nothing assumes a topic is "high weightage" unless you set its importance.

**Today's plan** (`shared/planner.js`): overdue → repeated/high-impact  → due today → optional maintenance, then packed into your time budget (items that don't fit are skipped, smaller ones still fill the gap).

**Accuracy** is reported two ways and only when the data exists: *among attempted* (correct ÷ correct+incorrect) and *among all* (correct ÷ total questions). Error-rate trends use attempted questions as the denominator so "more practice" isn't mistaken for "getting worse".

## Database

Postgres (Supabase in production; PGlite locally and in tests, so the same SQL runs everywhere). Schema changes are ordered migrations in `src/db.js`, applied automatically and tracked in `schema_migrations`. Tables: `subjects`, `topics` (self-referencing: subtopics), `streams`, `causes`, `tests`, `mistakes`, `reviews` (event log), `tasks`, `study_log`, `topic_progress`, `settings`, `attachments` (screenshots, resized in the browser before upload).

## Security

The API requires a session cookie (HttpOnly, SameSite=Strict, signed, 1-year, renewed on use). Changing `APP_PASSWORD` signs out every device. Cross-site requests are refused. If `APP_PASSWORD` is unset on Vercel the API refuses to serve data.

## Tests

```
npm test
```
Covers scheduling, priority, planner, analytics, API validation, bulk operations, tests↔mistakes linking, schedule tracker, restart persistence, login/session behaviour, attachments and path-traversal/cross-origin protections.

## Layout

```
api/[...path].js   Vercel serverless entry     src/       db (Postgres + migrations), store, validation, HTTP
public/            the app (no build step)     public/shared/  pure logic used by browser + server
test/              node:test suites            scripts/   icon generator, sample-data loader
```

## Known limitations

- Single user. Needs internet (the service worker only keeps the app shell for faster loads; data is always live).
- Dates use each device's local day. The server stores whatever date the browser sends.
- Mastery-progression chart shows what is *currently* mastered over time (a later reopening removes the earlier point).
- Not tested against a live Supabase/Vercel deployment from this machine; the Postgres code is tested on PGlite, and the thin `pg` connection adapter is exercised only when you deploy.
