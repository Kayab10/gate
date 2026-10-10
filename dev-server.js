// Local development server. Uses DATABASE_URL (e.g. your Supabase database) if set, otherwise an
// in-process Postgres (PGlite) stored in ./data/pglite so you can try everything offline.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/handler.js';
import { pgAdapter, pgliteAdapter } from './src/db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.GATE_DATA_DIR || path.join(dir, 'data');
const port = Number(process.env.PORT) || 5050;

const db = process.env.DATABASE_URL ? await pgAdapter(process.env.DATABASE_URL) : await pgliteAdapter(path.join(dataDir, 'pglite'));
const app = await createApp({ db, password: process.env.APP_PASSWORD || '' });
app.server.listen(port, '127.0.0.1', () => {
  console.log(`GATE Tracker running at http://localhost:${port}`);
  console.log(process.env.DATABASE_URL ? 'Database: DATABASE_URL (remote Postgres)' : `Database: local PGlite in ${path.join(dataDir, 'pglite')}`);
});
const stop = () => app.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
