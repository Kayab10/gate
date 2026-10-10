# Put it online (Vercel + Supabase) and install it on your phone

You do these steps in your own accounts; nothing here needs your keys to be shared with anyone.
Total time: about 15 minutes.

## 1. Supabase (the database)

1. Create a free project at https://supabase.com → **New project**. Pick a region near you (e.g. Mumbai) and set a **database password** (save it).
2. Open the project → **Connect** (top bar) → copy the **Transaction pooler** connection string (port **6543**).
   It looks like `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`.
   Replace `[YOUR-PASSWORD]` with your database password.
3. That's all — **you don't need to create tables**. The app builds the schema and the syllabus itself on its first request.

> Free Supabase projects pause after about a week of no use. Opening the app wakes it (the first load can take ~30 s). Daily use never pauses it.

## 2. Vercel (the website) — connected to your GitHub repo

1. In Vercel: **Add New → Project → import the `gate` repo**. Leave *Framework Preset* as **Other**; no build command is needed (`vercel.json` already sets the output folder).
2. Before deploying, open **Environment Variables** and add (Production **and** Preview):
   - `DATABASE_URL` — the Supabase **Transaction pooler** string from step 1 (the one with your *database password*; the `sb_publishable_…` / `sb_secret_…` API keys are **not** used).
   - *(optional)* `INVITE_CODE` — if set, people need this code to create an account. **Recommended** if the URL is public.
   - *(optional)* `SESSION_SECRET` — signs the login cookies; defaults to a key derived from `DATABASE_URL`.
3. **Deploy.** Every later `git push` redeploys automatically. After changing environment variables, redeploy once.

Tip: in Vercel → Project → Settings → Functions, set the region closest to your Supabase region so requests are fast.

## 3. Use it

- **First visit:** choose **Create account**, enter your email and a password, and pick your branch (**DA** or **ME**). Your own copy of that syllabus is created for you. Other people can do the same; each account's data is completely separate.
- **Laptop:** open the URL and sign in. You stay signed in for a year (it renews while you use it). You can add the other branch later from the sidebar switch button.
- **Phone:** open the URL, sign in once, then
  - **Android (Chrome):** menu ⋮ → **Install app** / **Add to Home screen**.
  - **iPhone (Safari):** Share → **Add to Home Screen**.
  It opens full-screen like a native app and shows the same data as your laptop.

## Updating later

Push to GitHub (Vercel redeploys on its own). The database upgrades itself (migrations run on the next request).

## Run locally (optional)

```bash
node dev-dev-server.js  # http://localhost:5050 — uses an in-process Postgres in ./data/pglite, separate from the cloud
```
To run locally **against your cloud data**, set `DATABASE_URL` in the environment first. (Locally you create a separate account; nothing is shared with the cloud unless you use `DATABASE_URL`.)

## Forgot a password?

There is no email reset. From this folder (with `DATABASE_URL` set to your Supabase string) run:

```bash
node scripts/reset-password.js you@example.com "a new long password"
```
