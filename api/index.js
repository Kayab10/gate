// Vercel serverless entry: every /api/* request lands here.
import { createHandler } from '../src/handler.js';
import { pgAdapter } from '../src/db.js';
import { checkUrl, describeUrl, explainDbError } from '../src/dbdiag.js';

let ready = null; // reused across invocations while the function stays warm

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
};

/** GET /api/health — step-by-step connection check. Never shows the password. */
async function health(res) {
  const url = process.env.DATABASE_URL || '';
  const report = { ok: false, environment: process.env.VERCEL_ENV || 'unknown', steps: [] };
  const step = (name, ok, extra = {}) => (report.steps.push({ step: name, ok, ...extra }), ok);

  const bad = checkUrl(url);
  if (!step('DATABASE_URL is set and looks right', !bad, bad || { details: (({ pooler, usernameLooksRight }) => ({ pooler, usernameLooksRight }))(describeUrl(url) || {}) })) return json(res, 200, report);

  const mod = await import('pg');
  const pg = mod.default;
  const u = new URL(url.trim());
  u.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  const client = new pg.Client({ connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    step('connected to the database server', true);
    const r = await client.query("SELECT to_regclass('public.users') AS users, to_regclass('public.schema_migrations') AS mig");
    if (!r.rows[0].mig) step('tables', true, { details: 'Database is empty; the tables will be created on the first sign-in.' });
    else if (!r.rows[0].users)
      step('tables', false, { message: 'The database still has the old single-user tables.', hint: 'In Supabase → SQL Editor run: drop table if exists schema_migrations, attachments, topic_progress, study_log, tasks, reviews, mistakes, tests, causes, topics, subjects, streams, settings, users cascade;  then reload this page.' });
    else step('tables', true, { details: 'Tables are in place.' });
  } catch (e) {
    step('connected to the database server', false, explainDbError(e, url));
  } finally {
    await client.end().catch(() => {});
  }
  report.ok = report.steps.every((s) => s.ok);
  json(res, 200, report);
}

export default async function handler(req, res) {
  try {
    if (new URL(req.url, 'http://x').pathname === '/api/health') return await health(res);
    const bad = checkUrl(process.env.DATABASE_URL || '');
    if (bad) return json(res, 503, { error: `${bad.message} ${bad.hint}` });
    ready ??= pgAdapter(process.env.DATABASE_URL).then(async (db) => ({ db, ...(await createHandler({ db })) }));
    const { handle } = await ready;
    await handle(req, res);
  } catch (e) {
    const old = ready;
    ready = null; // let the next request retry the connection/migration
    old?.then((r) => r.db.close()).catch(() => {}); // and do not leak the old pool
    console.error(e);
    const why = explainDbError(e, process.env.DATABASE_URL || '');
    json(res, 500, { error: `Cannot reach the database: ${why.message} ${why.hint} (Open /api/health on this site for a step-by-step check.)` });
  }
}
