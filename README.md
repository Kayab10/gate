# GATE 2027 Mistake Tracker

A mistake tracker, spaced-review scheduler, test log and study planner. It is a **PWA** (installable on your phone) that runs on
**Vercel** with data in **Supabase Postgres**, so your phone and laptop always show the same data.
**Accounts:** sign up with email + password and choose your branch (**DA** or **ME**); you stay signed in on that device for a year. Everyone's data — syllabus, mistakes, tests, schedule, settings, screenshots — is completely separate (each account gets its own copy of the syllabus for its branch, and every query is scoped to the signed-in user). You can add the other branch to your account later.

- **Put it online and install it:** see [DEPLOY.md](DEPLOY.md).
- **Try it locally first:** `node dev-server.js` → http://localhost:5050 (an in-process Postgres in `data/pglite`; create a local account on first visit). Node 22+.

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

## Demo data

Settings → **Demo data** loads about 20 sample mistakes (with review history), mock tests, planner tasks, study time and syllabus ticks into the branch you are studying, so you can see every screen. **Remove demo data** deletes only those (they are tagged `sample` / titled “[Sample]”) and keeps what you entered. The same from a terminal:

```bash
GATE_URL=https://your-app.vercel.app GATE_EMAIL=you@example.com GATE_PASSWORD='your password' node scripts/demo-data.js add
GATE_URL=https://your-app.vercel.app GATE_EMAIL=you@example.com GATE_PASSWORD='your password' node scripts/demo-data.js remove
```

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

Passwords are hashed with scrypt (salted). The API requires a signed session cookie (HttpOnly, SameSite=Strict, 1 year, renewed on use). Every table has a `user_id`, every query filters on it, and every id from a request is looked up together with the user id, so another user's id behaves like a missing one — covered by an automated cross-user test. Cross-site requests are refused. Optional `INVITE_CODE` limits who can create accounts.

## Tests

```
npm test
```
Covers scheduling, priority, planner, analytics, API validation, bulk operations, tests↔mistakes linking, schedule tracker, restart persistence, login/session behaviour, attachments and path-traversal/cross-origin protections.

## Layout

```
api/index.js          Vercel serverless entry (all /api/* rewritten here)
src/                  db (Postgres + migrations), store, validation, HTTP
public/               the app (no build step); public/shared/ = pure logic used by browser + server
test/                 node:test suites
scripts/              icons, demo-data, reset-password
```

## Known limitations

- Needs internet (the service worker only keeps the app shell for faster loads; data is always live).
- Dates use each device's local day; the browser always sends its date (the server's own date is only a fallback).
- Mastery-progression chart shows what is *currently* mastered over time (a later reopening removes the earlier point).
- The Postgres code is tested on PGlite; the thin `pg` connection adapter is only exercised on a real deployment.
