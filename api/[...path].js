// Vercel serverless entry: every /api/* request lands here.
import { createHandler } from '../src/app.js';
import { pgAdapter } from '../src/db.js';

let ready = null; // reused across invocations while the function stays warm

export default async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (Vercel → Settings → Environment Variables).');
    ready ??= pgAdapter(process.env.DATABASE_URL).then((db) => createHandler({ db }));
    const { handle } = await ready;
    await handle(req, res);
  } catch (e) {
    ready = null; // let the next request retry the connection/migration
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message.startsWith('DATABASE_URL') ? e.message : 'Cannot start the server — check the Vercel logs (database connection?).' }));
  }
}
