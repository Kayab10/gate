// HTTP layer: JSON API (+ static files for local dev). Used by api/index.js on Vercel and by dev-server.js locally.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initDb, BRANCHES } from './db.js';
import { createStore } from './store.js';
import { ValidationError } from './validate.js';
import { loadDemo, removeDemo } from './demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const MAX_BODY = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB; the browser shrinks screenshots before upload
const YEAR = 365 * 24 * 3600;
const SESSION_COOKIE = 'gate_session';

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(String(a)), sha(String(b)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns { handle, store }.
 *  secret      signs session cookies (defaults to SESSION_SECRET, else DATABASE_URL). Changing it signs everyone out.
 *  inviteCode  if set, new accounts must supply it (keeps strangers from signing up on your public URL).
 */
export async function createHandler({
  db,
  secret = process.env.SESSION_SECRET || process.env.DATABASE_URL || (process.env.VERCEL ? '' : 'local-dev-only-secret'),
  inviteCode = process.env.INVITE_CODE || '',
  serveStatic = false,
} = {}) {
  if (!secret) throw new Error('Cannot sign sessions: set DATABASE_URL (or SESSION_SECRET).');
  await initDb(db);
  const store = createStore(db);
  const key = crypto.createHmac('sha256', 'gate-session-v2').update(secret).digest();

  /* ----- sessions: a signed, stateless cookie "uid.exp.sig", valid one year and renewed while you keep using the app ----- */
  const sign = (uid, exp) => `${uid}.${exp}.${crypto.createHmac('sha256', key).update(`${uid}.${exp}`).digest('base64url')}`;
  const verifySession = (token) => {
    const [uid, exp, sig] = String(token || '').split('.');
    if (!uid || !exp || !sig || !(Number(exp) > Date.now() / 1000) || !Number.isInteger(Number(uid))) return null;
    const good = sign(uid, exp).split('.')[2];
    return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? { uid: Number(uid), exp: Number(exp) } : null;
  };
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), decodeURIComponent(c.slice(c.indexOf('=') + 1))]));
  const setSession = (req, res, uid) => {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted ? '; Secure' : '';
    const exp = Math.floor(Date.now() / 1000) + YEAR;
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sign(uid, exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${YEAR}${secure}`);
  };
  const clearSession = (res) => res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    if (req.body !== undefined && req.body !== null) {
      // Vercel pre-parses JSON bodies
      if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
      if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
      return req.body;
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    }
  };

  // Every route runs as the signed-in user: c.S is that user's data layer, c.stream the branch the browser has chosen.
  const routes = [
    ['GET', /^\/api\/bootstrap$/, (b, m, c) => c.S.bootstrap(c.stream)],
    ['GET', /^\/api\/streams$/, async (b, m, c) => ({ streams: await c.S.listStreams(), available: await c.S.availableBranches() })],
    ['POST', /^\/api\/streams$/, (b, m, c) => c.S.addBranch(String(b.code || ''))],
    ['PUT', /^\/api\/settings\/(\w+)$/, (b, m, c) => c.S.putSetting(m[1], b.value)],
    ['POST', /^\/api\/recompute$/, async (b, m, c) => (await c.S.recomputeAll(), { ok: true })],

    ['POST', /^\/api\/mistakes$/, (b, m, c) => c.S.createMistake(b)],
    ['POST', /^\/api\/mistakes\/bulk$/, (b, m, c) => c.S.bulk(b)],
    ['PUT', /^\/api\/mistakes\/(\d+)$/, (b, m, c) => c.S.updateMistake(+m[1], b)],
    ['DELETE', /^\/api\/mistakes\/(\d+)$/, (b, m, c) => c.S.deleteMistake(+m[1])],
    ['POST', /^\/api\/mistakes\/(\d+)\/duplicate$/, (b, m, c) => c.S.duplicateMistake(+m[1], b.date)],
    ['POST', /^\/api\/mistakes\/(\d+)\/reviews$/, (b, m, c) => c.S.addReview(+m[1], b)],
    ['PUT', /^\/api\/reviews\/(\d+)$/, (b, m, c) => c.S.updateReview(+m[1], b)],
    ['DELETE', /^\/api\/reviews\/(\d+)$/, (b, m, c) => c.S.deleteReview(+m[1])],

    ['POST', /^\/api\/tests$/, (b, m, c) => c.S.saveTest(null, b, c.stream)],
    ['PUT', /^\/api\/tests\/(\d+)$/, (b, m, c) => c.S.saveTest(+m[1], b)],
    ['DELETE', /^\/api\/tests\/(\d+)$/, (b, m, c) => c.S.deleteTest(+m[1])],

    ['POST', /^\/api\/tasks$/, (b, m, c) => c.S.saveTask(null, b, b.repeat_weeks, c.stream)],
    ['PUT', /^\/api\/tasks\/(\d+)$/, (b, m, c) => c.S.saveTask(+m[1], b)],
    ['DELETE', /^\/api\/tasks\/(\d+)$/, (b, m, c) => c.S.deleteTask(+m[1])],
    ['POST', /^\/api\/log$/, (b, m, c) => c.S.addLog(b, c.stream)],
    ['DELETE', /^\/api\/log\/(\d+)$/, (b, m, c) => c.S.deleteLog(+m[1])],
    ['PUT', /^\/api\/progress\/(\d+)$/, (b, m, c) => c.S.putProgress(+m[1], b)],

    ['POST', /^\/api\/subjects$/, (b, m, c) => c.S.saveSubject(null, b, c.stream)],
    ['PUT', /^\/api\/subjects\/(\d+)$/, (b, m, c) => c.S.saveSubject(+m[1], b)],
    ['DELETE', /^\/api\/subjects\/(\d+)$/, (b, m, c) => c.S.deleteSubject(+m[1])],
    ['POST', /^\/api\/topics$/, (b, m, c) => c.S.saveTopic(null, b)],
    ['PUT', /^\/api\/topics\/(\d+)$/, (b, m, c) => c.S.saveTopic(+m[1], b)],
    ['DELETE', /^\/api\/topics\/(\d+)$/, (b, m, c) => c.S.deleteTopic(+m[1])],
    ['POST', /^\/api\/causes$/, (b, m, c) => c.S.saveCause(null, b)],
    ['PUT', /^\/api\/causes\/(\d+)$/, (b, m, c) => c.S.saveCause(+m[1], b)],
    ['DELETE', /^\/api\/causes\/(\d+)$/, (b, m, c) => c.S.deleteCause(+m[1])],

    ['POST', /^\/api\/demo$/, (b, m, c) => loadDemo(c.S, c.stream, b.today)],
    ['DELETE', /^\/api\/demo$/, (b, m, c) => removeDemo(c.S)],

    ['POST', /^\/api\/attachments$/, (b, m, c) => {
      const mm = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.data || '');
      if (!mm) throw new ValidationError({ data: 'must be a PNG, JPEG, GIF or WebP data URL' });
      const buf = Buffer.from(mm[2], 'base64');
      if (buf.length > 3 * 1024 * 1024) throw new ValidationError({ data: 'image larger than 3 MB' });
      return c.S.saveAttachment(crypto.randomBytes(8).toString('hex') + IMG_EXT[mm[1]], mm[1], buf);
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-origin request refused' });

        const session = verifySession(cookies(req)[SESSION_COOKIE]);

        // ----- accounts -----
        if (url.pathname === '/api/session' && req.method === 'GET') {
          const user = session ? await store.getUser(session.uid) : null;
          return send(res, 200, { loggedIn: !!user, user, inviteRequired: !!inviteCode, branches: BRANCHES });
        }
        if (url.pathname === '/api/signup' && req.method === 'POST') {
          const b = await readBody(req);
          if (inviteCode && !safeEqual(b.invite ?? '', inviteCode)) {
            await sleep(800);
            return send(res, 403, { error: 'Wrong invite code', fields: { invite: 'wrong invite code' } });
          }
          const uid = await store.createUser({ email: b.email, name: b.name, password: b.password, branch: b.branch });
          setSession(req, res, uid);
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/login' && req.method === 'POST') {
          const b = await readBody(req);
          const uid = await store.verifyUser(b.email, b.password);
          if (!uid) {
            await sleep(800); // slows down password guessing
            return send(res, 401, { error: 'Wrong email or password' });
          }
          setSession(req, res, uid);
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') return (clearSession(res), send(res, 200, { ok: true }));

        // ----- everything else needs a valid session -----
        if (!session) return send(res, 401, { error: 'login' });
        if (session.exp - Date.now() / 1000 < YEAR / 2) setSession(req, res, session.uid); // sliding renewal: active use never expires
        const S = store.forUser(session.uid);

        const att = /^\/api\/attachments\/([\w.-]+)$/.exec(url.pathname);
        if (att && req.method === 'GET') {
          const a = await S.getAttachment(att[1]);
          if (!a) return send(res, 404, { error: 'Not found' });
          res.writeHead(200, { 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
          return res.end(a.data);
        }
        const ctx = { S, stream: Number(req.headers['x-stream']) || 0 };
        for (const [method, rx, fn] of routes) {
          const m = rx.exec(url.pathname);
          if (m && method === req.method) {
            const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
            return send(res, 200, await fn(body, m, ctx));
          }
        }
        return send(res, 404, { error: 'No such endpoint' });
      }
      if (!serveStatic) return send(res, 404, { error: 'Not found' });
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.resolve(PUBLIC, '.' + rel);
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      const dbConstraint = ['23505', '23503', '23514', '23502', '22P02', '22003', '22007', '22008'].includes(e.code);
      const status = e.status || (dbConstraint ? 400 : 500);
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? 'Server error — check the logs' : e.message, fields: e.errors });
    }
  }
  return { handle, store };
}

/** Local server (dev + tests). */
export async function createApp({ db, secret = 'test-secret', inviteCode = '', serveStatic = true }) {
  const { handle, store } = await createHandler({ db, secret, inviteCode, serveStatic });
  const server = http.createServer(handle);
  return {
    server, store,
    close: () =>
      new Promise((r) => {
        const done = async () => (await db.close(), r());
        if (!server.listening) return done();
        server.close(done);
        server.closeAllConnections();
      }),
  };
}
