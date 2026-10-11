// Shared UI helpers: escaping, API calls, toasts, dialogs, and the loaded data context.
import { scoreMistakes } from '/shared/planner.js';
import { todayStr } from '/shared/dates.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function request(method, url, body) {
  try {
    return await fetch(url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Today': todayStr(), ...(getStream() ? { 'X-Stream': getStream() } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the server. Check your internet connection.');
  }
}
export async function api(method, url, body) {
  let res = await request(method, url, body);
  if (res.status === 401 && url !== '/api/login') {
    await showLogin(); // asks for the password once; the session cookie then lasts a year
    res = await request(method, url, body);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 404 on an item we are showing = the screen is out of date (changed in another tab/device or account): reload it
    if (res.status === 404 && /not found/i.test(data.error || '') && D.loaded) setTimeout(() => window.dispatchEvent(new Event('gate:stale')), 0);
    throw new Error(res.status === 404 && /not found/i.test(data.error || '') ? 'That item changed elsewhere — refreshed, please try again.' : data.error || `Request failed (${res.status})`);
  }
  return data;
}

let loginPromise = null;
/** Sign in / create-account overlay. Resolves once signed in (the session cookie then lasts a year). */
export function showLogin() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve) => {
    const o = document.createElement('div');
    o.className = 'login';
    document.body.append(o);
    let mode = 'in';
    let info = { branches: [], inviteRequired: false };
    const draw = () => {
      const up = mode === 'up';
      o.innerHTML = `<form class="login-card" autocomplete="on"><div class="logo" style="width:40px;height:40px;font-size:1.2rem;margin-bottom:12px">✓</div><h1>GATE Tracker</h1>
        <p class="muted" style="margin-top:0">${up ? 'Create your account and choose your branch.' : 'Sign in. You stay signed in on this device for a year.'}</p>
        <div class="tabs" role="tablist" style="margin-bottom:14px"><button type="button" role="tab" data-mode="in" aria-selected="${!up}">Sign in</button><button type="button" role="tab" data-mode="up" aria-selected="${up}">Create account</button></div>
        <div class="stack">
          ${up ? '<input name="name" placeholder="Your name (optional)" autocomplete="name" style="width:100%">' : ''}
          <input name="email" type="email" placeholder="Email" autocomplete="username" required style="width:100%">
          <input name="password" type="password" placeholder="${up ? 'Password (8+ characters)' : 'Password'}" autocomplete="${up ? 'new-password' : 'current-password'}" required minlength="${up ? 8 : 1}" style="width:100%">
          ${up ? `<fieldset><legend>Which branch are you preparing for?</legend><div class="chips">${info.branches.map((b, i) => `<label class="chip"><input type="radio" name="branch" value="${esc(b.code)}"${i === 0 ? ' checked' : ''}><span>${esc(b.name)} (${esc(b.code)})</span></label>`).join('')}</div></fieldset>` : ''}
          ${up && info.inviteRequired ? '<input name="invite" placeholder="Invite code" required style="width:100%">' : ''}
        </div>
        <p class="err" data-err></p><button class="btn primary wide">${up ? 'Create account' : 'Sign in'}</button></form>`;
      o.querySelector('input[name=email]').focus();
    };
    o.addEventListener('click', (e) => {
      const t = e.target.closest('[data-mode]');
      if (t && t.dataset.mode !== mode) ((mode = t.dataset.mode), draw());
    });
    o.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const btn = o.querySelector('button.primary');
      btn.disabled = true;
      try {
        const body = mode === 'up'
          ? { name: f.name.value, email: f.email.value, password: f.password.value, branch: f.branch.value, invite: f.invite?.value }
          : { email: f.email.value, password: f.password.value };
        const r = await request('POST', mode === 'up' ? '/api/signup' : '/api/login', body);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong');
        o.remove(); // a saved branch that belongs to another account is rejected by the server and the picker shows

        loginPromise = null;
        resolve();
      } catch (ex) {
        o.querySelector('[data-err]').textContent = ex.message;
        btn.disabled = false;
      }
    });
    draw(); // show the form at once; sign-up details (branches, invite code) fill in when the server answers
    request('GET', '/api/session').then((r) => r.json()).then((s) => {
      if (!s.branches) return;
      const keep = ['name', 'email', 'password'].map((n) => [n, o.querySelector(`[name=${n}]`)?.value || '']);
      info = s;
      draw();
      for (const [n, v] of keep) { const el = o.querySelector(`[name=${n}]`); if (el && v) el.value = v; }
      (o.querySelector('[name=password]')?.value ? o.querySelector('[name=password]') : o.querySelector('[name=email]')).focus();
    }).catch(() => {});
  });
  return loginPromise;
}

/* ---------- branch (what you are studying) ---------- */
export const getStream = () => {
  try { return localStorage.getItem('stream') || ''; } catch { return ''; }
};
export const setStream = (id) => {
  try { localStorage.setItem('stream', String(id)); } catch { /* private mode: picker will simply show again */ }
};

/** Full-screen "What are you studying?" chooser. Resolves true when a branch was chosen, false if dismissed. */
export function pickStream(streams, available = [], { dismissable = false } = {}) {
  return new Promise((resolve) => {
    const o = document.createElement('div');
    o.className = 'login';
    const draw = (list, avail) => {
      o.innerHTML = `<div class="login-card" style="width:min(460px,100%)"><div class="logo" style="width:40px;height:40px;font-size:1.2rem;margin-bottom:12px">✓</div>
        <h1>What are you studying?</h1><p class="muted">Each branch keeps its own syllabus, mistakes, tests and schedule.</p>
        <div class="stack" style="margin:14px 0">${list.map((s) => `<button class="streamcard" data-id="${s.id}"><b>${esc(s.name)}</b><span class="badge info">${esc(s.code)}</span><small class="muted">${s.subjects} subjects · ${s.mistakes} open mistake${s.mistakes === 1 ? '' : 's'}</small></button>`).join('')}</div>
        ${avail.length ? `<div class="stack">${avail.map((b) => `<button class="btn wide" data-add="${esc(b.code)}">＋ Also study ${esc(b.name)} (${esc(b.code)})</button>`).join('')}<p class="err" data-err></p></div>` : ''}
        ${dismissable ? '<p style="margin:12px 0 0"><button class="btn ghost small" data-cancel>Cancel</button></p>' : ''}</div>`;
    };
    draw(streams, available);
    document.body.append(o);
    o.addEventListener('click', async (e) => {
      const c = e.target.closest('.streamcard');
      if (c) return (setStream(c.dataset.id), o.remove(), resolve(true));
      if (e.target.closest('[data-cancel]')) return (o.remove(), resolve(false));
      const add = e.target.closest('[data-add]');
      if (add) {
        try {
          const s = await api('POST', '/api/streams', { code: add.dataset.add });
          setStream(s.id);
          o.remove();
          resolve(true);
        } catch (ex) {
          o.querySelector('[data-err]').textContent = ex.message;
        }
      }
    });
  });
}

/* ---------- loaded data + derived lookups ---------- */
export const D = { loaded: false };
export async function load() {
  let d = await api('GET', '/api/bootstrap');
  if (d.needsStream) {
    if (d.streams.length === 1) setStream(d.streams[0].id); // only one branch: no need to ask
    else await pickStream(d.streams, d.available);
    d = await api('GET', '/api/bootstrap');
  }
  Object.assign(D, d, { loaded: true });
  D.today = todayStr(); // the browser's local date is authoritative for "today"
  D.subMap = new Map(d.subjects.map((s) => [s.id, s]));
  D.topMap = new Map(d.topics.map((t) => [t.id, t]));
  D.causeMap = new Map(d.causes.map((c) => [c.id, c]));
  D.testMap = new Map(d.tests.map((t) => [t.id, t]));
  D.live = d.mistakes.filter((m) => !m.archived);
  D.reviewsBy = new Map();
  for (const r of d.reviews) (D.reviewsBy.get(r.mistake_id) || D.reviewsBy.set(r.mistake_id, []).get(r.mistake_id)).push(r);
  D.prio = scoreMistakes(d.mistakes, d.subjects, d.topics, D.today, d.settings.priority);
  return D;
}
export const subName = (id) => D.subMap.get(id)?.name ?? '—';
export const topName = (id) => (id ? D.topMap.get(id)?.name ?? '—' : '—');
export const causeName = (id) => D.causeMap.get(id)?.name ?? '—';
export const topicsOf = (subjectId) => D.topics.filter((t) => t.subject_id === subjectId && !t.parent_id);
export const subtopicsOf = (topicId) => D.topics.filter((t) => t.parent_id === topicId);

/* ---------- formatting ---------- */
export const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
export const num = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d).replace(/\.0+$/, ''));
export const mins = (sec) => (sec == null ? '—' : sec >= 60 ? `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${Math.round(sec)}s`);
export const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
export const opts = (list, sel, blank) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
export function subjectOpts(sel, blank) {
  const opt = (s) => `<option value="${s.id}"${String(s.id) === String(sel ?? '') ? ' selected' : ''}>${esc(s.name)}</option>`;
  const sections = [...new Set(D.subjects.map((s) => s.section).filter(Boolean))];
  const body = sections.length > 1
    ? sections.map((sec) => `<optgroup label="${esc(sec)}">${D.subjects.filter((s) => s.section === sec).map(opt).join('')}</optgroup>`).join('') + D.subjects.filter((s) => !s.section).map(opt).join('')
    : D.subjects.map(opt).join('');
  return (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') + body;
}
export const empty = (msg) => `<div class="empty">${msg}</div>`;

export const STATUS_BADGE = { new: 'info', due_first: 'warn', in_progress: 'warn', improving: 'info', mastered: 'good', reopened: 'bad' };

/* ---------- toasts + dialogs ---------- */
export function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), isErr ? 7000 : 3500);
}
export function fail(e) {
  console.error(e);
  toast(e.message || String(e), true);
}

const openStack = [];
export function openModal(title, bodyHtml, { wide = false, onClose } = {}) {
  const dlg = document.createElement('dialog');
  if (wide) dlg.className = 'wide';
  dlg.innerHTML = `<div class="dlg-head"><h2 style="margin:0">${esc(title)}</h2><button class="btn ghost small" data-close aria-label="Close">✕</button></div><div class="dlg-body">${bodyHtml}</div>`;
  document.body.append(dlg);
  const close = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    dlg.remove();
    openStack.splice(openStack.indexOf(dlg), 1);
    onClose?.();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
    else if (e.target === dlg) close();
  });
  openStack.push(dlg);
  dlg.showModal();
  return { dlg, body: $('.dlg-body', dlg), close };
}
export const modalOpen = () => openStack.length > 0;
export function closeAllModals() {
  [...openStack].forEach((d) => d.close());
}

export function confirmDialog(message, { okLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal('Please confirm', `<p class="pre">${esc(message)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`, {
      onClose: () => !answered && resolve(false),
    });
    m.dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-yes]')) ((answered = true), resolve(true), m.close());
      else if (e.target.closest('[data-no]')) ((answered = true), resolve(false), m.close());
    });
    $('[data-no]', m.dlg).focus();
  });
}

export function askText(title, label, value = '') {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal(title, `<form><label><span class="lab">${esc(label)}</span><input name="v" value="${esc(value)}" style="width:100%" required></label><div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">OK</button></div></form>`, { onClose: () => !answered && resolve(null) });
    m.dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      answered = true;
      resolve(e.target.v.value.trim() || null);
      m.close();
    });
    m.dlg.querySelector('input').focus();
  });
}

/** Replace host's content with a fresh container so event listeners never pile up across re-renders. */
export function mount(host) {
  const d = document.createElement('div');
  host.replaceChildren(d);
  return d;
}

/* ---------- misc ---------- */
/** Downscale big screenshots before upload (phones take multi-MB photos; the server accepts up to 2.5 MB). */
export async function shrinkImage(file, max = 1600, quality = 0.85) {
  if (file.type === 'image/gif' || !self.createImageBitmap) return fileToDataUrl(file);
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
}
export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
};
export const attUrl = (f) => `/api/attachments/${encodeURIComponent(f)}`;
