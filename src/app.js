// HTTP layer: JSON API (+ static files for local dev). Used by api/[...path].js on Vercel and by server.js locally.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { createStore } from './store.js';
import { ValidationError } from './validate.js';

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

/** Returns { handle, ready }. `password` enables login (empty = open, for local use only). */
export async function createHandler({ db, password = process.env.APP_PASSWORD || '', serveStatic = false, requirePassword = !!process.env.VERCEL } = {}) {
  await initDb(db);
  const store = createStore(db);
  const key = crypto.createHmac('sha256', 'gate-session-v1').update(password).digest(); // changing the password signs everyone out

  const sign = (exp) => `${exp}.${crypto.createHmac('sha256', key).update(String(exp)).digest('base64url')}`;
  const verifySession = (token) => {
    const [exp, sig] = String(token || '').split('.');
    if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return null;
    const good = sign(exp).split('.')[1];
    return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? Number(exp) : null;
  };
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), decodeURIComponent(c.slice(c.indexOf('=') + 1))]));
  const setSession = (req, res) => {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted ? '; Secure' : '';
    const exp = Math.floor(Date.now() / 1000) + YEAR;
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${YEAR}${secure}`);
  };
  const clearSession = (res) => res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

  const send = (res, status, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(isBuf ? body : JSON.stringify(body));
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

  const routes = [
    ['GET', /^\/api\/bootstrap$/, (b, m, ctx) => store.bootstrap(ctx.stream)],
    ['GET', /^\/api\/streams$/, () => store.listStreams()],
    ['POST', /^\/api\/streams$/, (b) => store.createStream(b)],
    ['PUT', /^\/api\/streams\/(\d+)$/, (b, m) => store.updateStream(+m[1], b)],
    ['DELETE', /^\/api\/streams\/(\d+)$/, (b, m) => store.deleteStream(+m[1])],
    ['PUT', /^\/api\/settings\/(\w+)$/, (b, m) => store.putSetting(m[1], b.value)],
    ['POST', /^\/api\/recompute$/, async () => (await store.recomputeAll(), { ok: true })],

    ['POST', /^\/api\/mistakes$/, (b) => store.createMistake(b)],
    ['POST', /^\/api\/mistakes\/bulk$/, (b) => store.bulk(b)],
    ['PUT', /^\/api\/mistakes\/(\d+)$/, (b, m) => store.updateMistake(+m[1], b)],
    ['DELETE', /^\/api\/mistakes\/(\d+)$/, (b, m) => store.deleteMistake(+m[1])],
    ['POST', /^\/api\/mistakes\/(\d+)\/duplicate$/, (b, m) => store.duplicateMistake(+m[1], b.date)],
    ['POST', /^\/api\/mistakes\/(\d+)\/reviews$/, (b, m) => store.addReview(+m[1], b)],
    ['PUT', /^\/api\/reviews\/(\d+)$/, (b, m) => store.updateReview(+m[1], b)],
    ['DELETE', /^\/api\/reviews\/(\d+)$/, (b, m) => store.deleteReview(+m[1])],

    ['POST', /^\/api\/tests$/, (b, m, ctx) => store.saveTest(null, b, ctx.stream)],
    ['PUT', /^\/api\/tests\/(\d+)$/, (b, m) => store.saveTest(+m[1], b)],
    ['DELETE', /^\/api\/tests\/(\d+)$/, (b, m) => store.deleteTest(+m[1])],

    ['POST', /^\/api\/tasks$/, (b, m, ctx) => store.saveTask(null, b, b.repeat_weeks, ctx.stream)],
    ['PUT', /^\/api\/tasks\/(\d+)$/, (b, m) => store.saveTask(+m[1], b)],
    ['DELETE', /^\/api\/tasks\/(\d+)$/, (b, m) => store.deleteTask(+m[1])],
    ['POST', /^\/api\/log$/, (b, m, ctx) => store.addLog(b, ctx.stream)],
    ['DELETE', /^\/api\/log\/(\d+)$/, (b, m) => store.deleteLog(+m[1])],
    ['PUT', /^\/api\/progress\/(\d+)$/, (b, m) => store.putProgress(+m[1], b)],

    ['POST', /^\/api\/subjects$/, (b, m, ctx) => store.saveSubject(null, b, ctx.stream)],
    ['PUT', /^\/api\/subjects\/(\d+)$/, (b, m) => store.saveSubject(+m[1], b)],
    ['DELETE', /^\/api\/subjects\/(\d+)$/, (b, m) => store.deleteSubject(+m[1])],
    ['POST', /^\/api\/topics$/, (b) => store.saveTopic(null, b)],
    ['PUT', /^\/api\/topics\/(\d+)$/, (b, m) => store.saveTopic(+m[1], b)],
    ['DELETE', /^\/api\/topics\/(\d+)$/, (b, m) => store.deleteTopic(+m[1])],
    ['POST', /^\/api\/causes$/, (b) => store.saveCause(null, b)],
    ['PUT', /^\/api\/causes\/(\d+)$/, (b, m) => store.saveCause(+m[1], b)],
    ['DELETE', /^\/api\/causes\/(\d+)$/, (b, m) => store.deleteCause(+m[1])],

    ['POST', /^\/api\/attachments$/, (b) => {
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.data || '');
      if (!m) throw new ValidationError({ data: 'must be a PNG, JPEG, GIF or WebP data URL' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 3 * 1024 * 1024) throw new ValidationError({ data: 'image larger than 3 MB' });
      return store.saveAttachment(crypto.randomBytes(8).toString('hex') + IMG_EXT[m[1]], m[1], buf);
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-origin request refused' });

        // ----- session / login -----
        const open = !password;
        if (open && requirePassword) return send(res, 503, { error: 'Server is not configured: set the APP_PASSWORD environment variable.' });
        const exp = open ? Infinity : verifySession(cookies(req)[SESSION_COOKIE]);
        if (url.pathname === '/api/session' && req.method === 'GET') return send(res, 200, { loggedIn: !!exp, passwordRequired: !open });
        if (url.pathname === '/api/login' && req.method === 'POST') {
          const b = await readBody(req);
          if (open) return send(res, 200, { ok: true });
          if (!safeEqual(b.password ?? '', password)) {
            await new Promise((r) => setTimeout(r, 800)); // slows down guessing
            return send(res, 401, { error: 'Wrong password' });
          }
          setSession(req, res);
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') return (clearSession(res), send(res, 200, { ok: true }));
        if (!exp) return send(res, 401, { error: 'login' });
        if (exp !== Infinity && exp - Date.now() / 1000 < YEAR / 2) setSession(req, res); // sliding renewal: active use never expires

        const att = /^\/api\/attachments\/([\w.-]+)$/.exec(url.pathname);
        if (att && req.method === 'GET') {
          const a = await store.getAttachment(att[1]);
          if (!a) return send(res, 404, { error: 'Not found' });
          res.writeHead(200, { 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
          return res.end(a.data);
        }
        for (const [method, rx, fn] of routes) {
          const m = rx.exec(url.pathname);
          if (m && method === req.method) {
            const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
            return send(res, 200, await fn(body, m, { stream: Number(req.headers['x-stream']) || 0 }));
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
export async function createApp({ db, password = '', serveStatic = true }) {
  const { handle, store } = await createHandler({ db, password, serveStatic, requirePassword: false });
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
