// Load or remove the demo data from the command line (the same thing the "Demo data" buttons in Settings do).
//
//   GATE_URL=https://your-app.vercel.app GATE_EMAIL=you@example.com GATE_PASSWORD='your password' node scripts/demo-data.js add
//   GATE_URL=https://your-app.vercel.app GATE_EMAIL=you@example.com GATE_PASSWORD='your password' node scripts/demo-data.js remove
//
// Optional: GATE_BRANCH=DA or ME (default: your first branch). Against http://localhost it creates a demo account if needed.
const [cmd] = process.argv.slice(2);
const BASE = (process.env.GATE_URL || `http://localhost:${process.env.PORT || 5050}`).replace(/\/$/, '');
const EMAIL = process.env.GATE_EMAIL || (BASE.includes('localhost') ? 'demo@example.com' : '');
const PASSWORD = process.env.GATE_PASSWORD || (BASE.includes('localhost') ? 'demo-password-1' : '');
if (!['add', 'remove'].includes(cmd) || !EMAIL || !PASSWORD) {
  console.error('Usage: GATE_URL=... GATE_EMAIL=... GATE_PASSWORD=... node scripts/demo-data.js <add|remove>');
  process.exit(1);
}

let cookie = '';
let stream = '';
async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(stream ? { 'X-Stream': String(stream) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${j.error || r.status}`);
  return j;
}
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

try {
  try {
    await api('POST', '/api/login', { email: EMAIL, password: PASSWORD });
  } catch (e) {
    if (!BASE.includes('localhost')) throw new Error(`Could not sign in as ${EMAIL} (${e.message}). Create the account in the app first.`);
    await api('POST', '/api/signup', { email: EMAIL, password: PASSWORD, name: 'Demo', branch: process.env.GATE_BRANCH || 'ME' });
    console.log(`Created local demo account ${EMAIL}`);
  }
  const { streams } = await api('GET', '/api/streams');
  stream = (streams.find((s) => s.code === process.env.GATE_BRANCH) || streams[0]).id;
  if (cmd === 'add') {
    const r = await api('POST', '/api/demo', { today });
    console.log(r.already ? 'Demo data was already loaded.' : `Loaded ${r.mistakes} sample mistakes and ${r.tests} tests, plus a planner, study log and checklist.`);
  } else {
    const r = await api('DELETE', '/api/demo');
    console.log(`Removed ${r.mistakes} sample mistakes, ${r.tests} tests, ${r.tasks} tasks, ${r.log} study-log entries, ${r.ticks} checklist ticks.`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
