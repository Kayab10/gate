// Pomodoro timer for the study log. State lives in localStorage and uses absolute end times, so it keeps
// counting while you visit other pages, switch tabs, or reload. A finished focus session is logged automatically.
import { api, opts, subjectOpts, toast, fail } from './util.js';
import { todayStr } from '/shared/dates.js';

const KEY = 'pomodoro';
const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const base = () => ({ mode: 'focus', running: false, endsAt: 0, left: 25 * 60, cfg: { focus: 25, short: 5, long: 15 }, done: 0, day: '', subject_id: '', activity: 'Study', autoLog: true });

let st = base();
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* start fresh */ }
st.cfg = { ...base().cfg, ...st.cfg };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode: timer still works until reload */ } };
const full = (mode = st.mode) => Math.max(1, Math.round(Number(st.cfg[mode]) || 1)) * 60;
const remaining = () => (st.running ? Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)) : st.left);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

let audio = null;
function beep() {
  try {
    const c = audio;
    if (!c) return;
    [0, 0.3, 0.6].forEach((t) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.18);
    });
  } catch { /* no sound is fine */ }
}

const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

async function complete() {
  const was = st.mode;
  st.running = false;
  document.title = 'GATE Tracker';
  if (st.day !== todayStr()) (st.day = todayStr()), (st.done = 0);
  if (was === 'focus') st.done++;
  st.mode = was === 'focus' ? (st.done % 4 === 0 ? 'long' : 'short') : 'focus';
  st.left = full();
  save();
  beep();
  const msg = was === 'focus' ? `Focus session done — time for a ${MODES[st.mode].toLowerCase()}.` : 'Break over — ready for the next focus session.';
  toast(msg);
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('GATE Tracker', { body: msg }); } catch { /* ignore */ }
  emit();
  if (was === 'focus' && st.autoLog) {
    try {
      await api('POST', '/api/log', { date: todayStr(), minutes: Math.max(1, Math.round(st.cfg.focus)), subject_id: st.subject_id || null, activity: st.activity || 'Study', note: 'Pomodoro' });
      window.dispatchEvent(new Event('gate:stale')); // reload the data so the log, tiles and streak update
    } catch (e) { fail(e); }
  }
}

setInterval(() => {
  if (st.running && remaining() <= 0) complete();
  else if (st.running) {
    document.title = `${mmss(remaining())} · ${MODES[st.mode]}`;
    emit();
  }
}, 1000);
if (st.running && remaining() <= 0) complete(); // finished while the app was closed

const actions = {
  start() {
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* ignore */ }
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
    st.endsAt = Date.now() + st.left * 1000;
    st.running = true;
  },
  pause() { st.left = remaining(); st.running = false; document.title = 'GATE Tracker'; },
  reset() { st.running = false; st.left = full(); document.title = 'GATE Tracker'; },
  skip() { st.running = false; st.mode = st.mode === 'focus' ? 'short' : 'focus'; st.left = full(); document.title = 'GATE Tracker'; },
};

/** Draws the timer into `el`. Per-second updates only touch the clock text, so inputs keep their focus. */
export function renderPomodoro(el, activities) {
  if (st.day !== todayStr()) (st.day = todayStr()), (st.done = 0);
  const draw = () => {
    const total = full(), left = remaining();
    el.innerHTML = `<section class="card pomo" data-mode="${st.mode}">
  <div class="row between"><h2 style="margin:0">Focus timer</h2><span class="muted small">Sessions today: <b data-done>${st.done}</b> · long break after every 4</span></div>
  <div class="tabs" role="tablist" style="margin:12px 0">${Object.entries(MODES).map(([k, l]) => `<button type="button" role="tab" data-mode="${k}" aria-selected="${st.mode === k}">${l} · ${st.cfg[k]}m</button>`).join('')}</div>
  <div class="pomo-clock" data-clock aria-live="off">${mmss(left)}</div>
  <div class="prog" style="margin:8px 0 14px"><div data-bar style="width:${Math.min(100, ((total - left) / total) * 100)}%"></div></div>
  <div class="row">
    <button type="button" class="btn primary" data-act="${st.running ? 'pause' : 'start'}">${st.running ? 'Pause' : left < total ? 'Resume' : 'Start'}</button>
    <button type="button" class="btn" data-act="reset">Reset</button>
    <button type="button" class="btn ghost" data-act="skip" title="Skip to the next phase (a skipped focus session is not logged)">Skip</button>
  </div>
  <details class="more" style="margin-top:14px"><summary>Timer settings and what to log</summary>
    <div class="fgrid" style="margin-top:8px">
      <label><span class="lab">Focus (min)</span><input type="number" min="1" max="180" data-cfg="focus" value="${st.cfg.focus}"></label>
      <label><span class="lab">Short break (min)</span><input type="number" min="1" max="60" data-cfg="short" value="${st.cfg.short}"></label>
      <label><span class="lab">Long break (min)</span><input type="number" min="1" max="90" data-cfg="long" value="${st.cfg.long}"></label>
      <label><span class="lab">Subject for the log</span><select data-f="subject_id"><option value="">—</option>${subjectOpts(st.subject_id)}</select></label>
      <label><span class="lab">Activity</span><select data-f="activity">${opts(activities.map((a) => [a, a]), st.activity)}</select></label>
      <label class="row" style="align-self:end"><input type="checkbox" data-f="autoLog"${st.autoLog ? ' checked' : ''}> <span>Log finished focus sessions automatically</span></label>
    </div>
  </details>
</section>`;
  };
  const tick = () => {
    if (!el.isConnected) return listeners.delete(tick); // the page was re-rendered
    const total = full(), left = remaining();
    const c = el.querySelector('[data-clock]'), b = el.querySelector('[data-bar]'), d = el.querySelector('[data-done]');
    if (!c) return;
    c.textContent = mmss(left);
    b.style.width = `${Math.min(100, ((total - left) / total) * 100)}%`;
    d.textContent = st.done;
    if (!st.running && el.querySelector('[data-act=pause]')) draw(); // finished: show Start again
    if (st.running && el.querySelector('[data-act=start]')) draw();
  };
  listeners.add(tick);
  draw();
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    const m = e.target.closest('[data-mode]')?.dataset.mode;
    if (a) { actions[a](); save(); draw(); }
    else if (m && m !== st.mode) { st.mode = m; st.running = false; st.left = full(); save(); draw(); }
  });
  el.addEventListener('change', (e) => {
    const cfg = e.target.dataset.cfg, f = e.target.dataset.f;
    if (cfg) {
      st.cfg[cfg] = Math.min(Number(e.target.max) || 180, Math.max(1, Math.round(Number(e.target.value) || 1)));
      if (cfg === st.mode && !st.running) st.left = full();
      save(); draw();
      el.querySelector('details').open = true;
    } else if (f) {
      st[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      save();
    }
  });
}
