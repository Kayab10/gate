# GATE 2027 Tracker

A concept tracker with spaced review, test-score log, timer and to-do list. It is a **PWA** (installable on your phone) that runs on
**Vercel** with data in **Supabase Postgres**, so your phone and laptop always show the same data.
**Accounts:** sign up with email + password and choose your branch (**DA** or **ME**); you stay signed in on that device for a year. Everyone's data — syllabus, mistakes, tests, schedule, settings, screenshots — is completely separate (each account gets its own copy of the syllabus for its branch, and every query is scoped to the signed-in user). You can add the other branch to your account later.

- **Put it online and install it:** see [DEPLOY.md](DEPLOY.md).
- **Try it locally first:** `node dev-server.js` → http://localhost:5050 (an in-process Postgres in `data/pglite`; create a local account on first visit). Node 22+.

## Pages

| Page | What it does |
|---|---|
| Today | Days left, time studied, concepts due for review, today's to-dos, latest score per tier |
| To-do | Today / This week task lists (▶ starts the timer on a task, repeat weekly, missed tasks roll over), plus the syllabus checklist |
| Timer | **Pomodoro or stopwatch**; time is logged automatically (optionally against a to-do). Study log, weekly totals, consistency calendar. A running timer shows in a bar on every page |
| Concepts | Write a *concept* instead of a question: a title, a tag (🔴 struggled with / 🟡 must remember / 🟢 new in an exam), subject, optional note. Concepts are resurfaced on the review schedule below |
| Tests | Enter marks only. Tiers: weekly quiz → topic-wise → subject-wise → full mock, with an optional platform and link. Latest / best / last-3 average per tier and a progress chart |
| More | Branch switch, theme, settings (exam date, review intervals, syllabus editor) |

## How the algorithms work

**Review scheduling** (`shared/srs.js`). Default intervals 1, 3, 7, 14, 30 days, each measured from the *actual date of the previous review* (so overdue reviews don't compress the spacing). A concept's state is always **re-derived by replaying its review events**, which is why editing dates, undoing a review or changing intervals can never leave it inconsistent.
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
scripts/              icons, reset-password
```

## Known limitations

- Needs internet (the service worker only keeps the app shell for faster loads; data is always live).
- Dates use each device's local day; the browser always sends its date (the server's own date is only a fallback).
- Mastery-progression chart shows what is *currently* mastered over time (a later reopening removes the earlier point).
- The Postgres code is tested on PGlite; the thin `pg` connection adapter is only exercised on a real deployment.
