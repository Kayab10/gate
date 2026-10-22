// Timer: Pomodoro or stopwatch, plus the study log. State lives in localStorage with absolute timestamps, so it keeps
// counting while you visit other pages, switch tabs, or reload. Finished time is logged automatically, optionally against a to-do.
import { mount, D, esc, $, api, opts, subjectOpts, subName, toast, fail, empty, dur } from './util.js';
import { todayStr, addDays, weekStart } from '/shared/dates.js';
import { ring, ringOffset } from './charts.js';

const KEY = 'pomodoro';
const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const ACTIVITIES = ['Study', 'Revision', 'Practice', 'Mock', 'PYQ', 'Test analysis', 'Concept review', 'Other'];
const base = () => ({ kind: 'pomodoro', mode: 'focus', running: false, endsAt: 0, left: 25 * 60, cfg: { focus: 25, short: 5, long: 15 }, done: 0, day: '', subject_id: '', task_id: '', activity: 'Study', autoLog: true, swRunning: false, swStart: 0, swElapsed: 0 });

let st = base();
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* start fresh */ }
st.cfg = { ...base().cfg, ...st.cfg };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode: timer still works until reload */ } };
const full = (mode = st.mode) => Math.max(1, Math.round(Number(st.cfg[mode]) || 1)) * 60;
const remaining = () => (st.running ? Math.max(0, Math.round((st.endsAt - Date.now()) / 1000)) : st.left);
const swElapsed = () => Math.floor(st.swElapsed + (st.swRunning ? (Date.now() - st.swStart) / 1000 : 0));
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const prog = (total, left) => (st.kind === 'pomodoro' ? (total - left) / total : (swElapsed() % 60) / 60);
const hms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${mmss(s % 3600)}` : mmss(s));
const reset = () => { document.title = 'GATE Tracker'; };

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

/** What the always-visible bar shows: null when nothing is running. */
export function runningInfo() {
  const task = st.task_id ? D.tasks?.find((t) => t.id === Number(st.task_id)) : null;
  if (st.kind === 'stopwatch' && st.swRunning) return { text: hms(swElapsed()), label: 'Stopwatch', task };
  if (st.kind === 'pomodoro' && st.running) return { text: mmss(remaining()), label: MODES[st.mode], task };
  return null;
}
export const onTick = (f) => { listeners.add(f); return () => listeners.delete(f); };

/** Add minutes to the study log (the chosen to-do supplies the subject and is linked to the entry). */
async function logMinutes(minutes, how) {
  if (!st.autoLog || minutes < 1) return;
  const task = st.task_id ? D.tasks?.find((t) => t.id === Number(st.task_id)) : null;
  try {
    await api('POST', '/api/log', {
      date: todayStr(), minutes, subject_id: task?.subject_id ?? (st.subject_id || null), task_id: task?.id ?? null,
      activity: st.activity || 'Study', note: task ? `${how} · ${task.title}`.slice(0, 1000) : how,
    });
    window.dispatchEvent(new Event('gate:stale')); // reload the data so the log, tiles and streak update
  } catch (e) { fail(e); }
}
/** Whole minutes of the current focus session already spent, for stop/skip/switch. */
const spentFocusMin = () => (st.kind === 'pomodoro' && st.mode === 'focus' ? Math.floor((full() - remaining()) / 60) : 0);
function flushPartial() {
  const m = spentFocusMin();
  if (m >= 1 && st.autoLog) { toast(`Logged ${m} min of focus`); logMinutes(m, 'Pomodoro'); }
}

async function complete() {
  const was = st.mode;
  st.running = false;
  reset();
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
  if (was === 'focus') await logMinutes(Math.max(1, Math.round(st.cfg.focus)), 'Pomodoro');
}

setInterval(() => {
  if (st.kind === 'pomodoro' && st.running && remaining() <= 0) return complete();
  const info = runningInfo();
  if (info) document.title = `${info.text} · ${info.label}`;
  if (info || listeners.size) emit();
}, 1000);
if (st.running && remaining() <= 0) complete(); // finished while the app was closed

const actions = {
  start() {
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* ignore */ }
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
    if (st.kind === 'stopwatch') { st.swStart = Date.now(); st.swRunning = true; }
    else { st.endsAt = Date.now() + st.left * 1000; st.running = true; }
  },
  pause() {
    if (st.kind === 'stopwatch') { st.swElapsed = swElapsed(); st.swRunning = false; }
    else { st.left = remaining(); st.running = false; }
    reset();
  },
  reset() { // pomodoro: logs the focus time already spent; stopwatch: logs everything counted and clears
    if (st.kind === 'stopwatch') {
      const m = Math.round(swElapsed() / 60);
      st.swRunning = false; st.swElapsed = 0;
      if (m >= 1 && st.autoLog) { toast(`Logged ${m} min`); logMinutes(m, 'Stopwatch'); }
    } else { flushPartial(); st.running = false; st.left = full(); }
    reset();
  },
  skip() { flushPartial(); st.running = false; st.mode = st.mode === 'focus' ? 'short' : 'focus'; st.left = full(); reset(); },
};

/** Start the timer on a to-do (called from the ▶ button in the to-do list). */
export function startTask(taskId) {
  const was = runningInfo();
  if (was) actions.pause();
  st.task_id = String(taskId);
  actions.start();
  save();
  emit();
}

/** The Timer page. */
export function renderTimer(host, refresh) {
  const root = mount(host);
  if (st.day !== todayStr()) (st.day = todayStr()), (st.done = 0);
  root.innerHTML = `
<div class="page-head"><div><h1>Timer</h1><p>Pomodoro or stopwatch — time goes into your study log automatically.</p></div></div>
<div id="clock"></div>
<div id="logBody"></div>`;
  drawClock($('#clock', root));
  studyLog($('#logBody', root), refresh);
}

const PRESETS = [15, 25, 45, 60];

function drawClock(el) {
  const sumDay = (d) => D.studyLog.filter((l) => l.date === d).reduce((a, l) => a + l.minutes, 0);
  const draw = () => {
    const pomo = st.kind === 'pomodoro';
    const total = full(), left = remaining();
    const running = pomo ? st.running : st.swRunning;
    const started = pomo ? left < total : swElapsed() > 0;
    const ws = weekStart(todayStr());
    const weekMin = [...Array(7)].reduce((a, _, i) => a + sumDay(addDays(ws, i)), 0);
    const tasks = (D.tasks || []).filter((t) => t.date === todayStr() && !t.done);
    const cycle = st.done % 4;
    el.innerHTML = `<div class="timergrid">
<section class="card pomo" data-mode="${pomo ? st.mode : 'focus'}">
  <div class="seg" role="tablist"><button type="button" role="tab" data-kind="pomodoro" aria-selected="${pomo}">Pomodoro</button><button type="button" role="tab" data-kind="stopwatch" aria-selected="${!pomo}">Stopwatch</button></div>
  ${pomo ? `<div class="modes">${Object.entries(MODES).map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${st.mode === k}">${l}<small>${st.cfg[k]}m</small></button>`).join('')}</div>` : '<div class="modes" style="visibility:hidden"><button type="button">.</button></div>'}
  <div class="timerring">${ring(prog(total, left))}<div class="pomo-clock" data-clock aria-live="off">${pomo ? mmss(left) : hms(swElapsed())}</div><div class="sub">${pomo ? MODES[st.mode] : 'Elapsed'}</div></div>
  <div class="controls">
    <button type="button" class="btn big" data-act="reset" title="${pomo ? 'Reset (focus time already spent is logged)' : 'Stop and log the time'}">${pomo ? '↺' : '■'}<span>${pomo ? 'Reset' : 'Stop & log'}</span></button>
    <button type="button" class="btn primary play" data-act="${running ? 'pause' : 'start'}" aria-label="${running ? 'Pause' : 'Start'}">${running ? '❚❚' : '▶'}</button>
    ${pomo ? '<button type="button" class="btn big" data-act="skip" title="Skip to the next phase (focus time already spent is logged)">»<span>Skip</span></button>' : '<span class="big-spacer"></span>'}
  </div>
  ${pomo ? `<div class="cycle" title="Sessions today: ${st.done}"><span class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i < cycle ? 'on' : ''}"></i>`).join('')}</span><span class="muted small">Session ${cycle + 1} of 4 · <b data-done>${st.done}</b> done today</span></div>
  <div class="presets">${PRESETS.map((m) => `<button type="button" data-preset="${m}" aria-pressed="${st.cfg.focus === m}">${m} min</button>`).join('')}</div>` : '<p class="muted small center" style="margin:14px 0 0">Counts up until you press “Stop &amp; log”. Pausing keeps what you have.</p>'}
</section>
<div class="timerside">
  <section class="card"><h2>Working on</h2>
    <div class="picklist">
      <button type="button" class="pick${st.task_id ? '' : ' on'}" data-pick=""><span class="rb"></span><span>Nothing specific</span></button>
      ${tasks.map((t) => `<button type="button" class="pick${String(t.id) === String(st.task_id) ? ' on' : ''}" data-pick="${t.id}"><span class="rb"></span><span>${esc(t.title)}${t.subject_id ? `<small>${esc(subName(t.subject_id))}</small>` : ''}</span></button>`).join('')}
    </div>
    ${tasks.length ? '' : '<p class="hint" style="margin:8px 0 0">No open to-dos for today. Add some in the To-do tab to link your time.</p>'}
  </section>
  <section class="card"><h2>Today</h2>
    <div class="miniStats"><div><b>${dur(sumDay(todayStr())) || '0m'}</b><span>focused</span></div><div><b>${st.done}</b><span>sessions</span></div><div><b>${dur(weekMin) || '0m'}</b><span>this week</span></div></div>
  </section>
  <details class="card"><summary class="row between" style="cursor:pointer"><h2 style="margin:0">Settings</h2><span class="muted small">durations, subject</span></summary>
    <div class="fgrid" style="margin-top:12px">
      <label><span class="lab">Focus (min)</span><input type="number" min="1" max="180" data-cfg="focus" value="${st.cfg.focus}"></label>
      <label><span class="lab">Short break (min)</span><input type="number" min="1" max="60" data-cfg="short" value="${st.cfg.short}"></label>
      <label><span class="lab">Long break (min)</span><input type="number" min="1" max="90" data-cfg="long" value="${st.cfg.long}"></label>
      <label><span class="lab">Subject (when no to-do is chosen)</span><select data-f="subject_id"><option value="">—</option>${subjectOpts(st.subject_id)}</select></label>
      <label><span class="lab">Activity</span><select data-f="activity">${opts(ACTIVITIES.map((a) => [a, a]), st.activity)}</select></label>
      <label class="row" style="align-self:end"><input type="checkbox" data-f="autoLog"${st.autoLog ? ' checked' : ''}> <span>Log time automatically</span></label>
    </div>
  </details>
</div></div>`;
  };
  const tick = () => {
    if (!el.isConnected) return listeners.delete(tick); // the page was re-rendered
    const c = el.querySelector('[data-clock]');
    if (!c) return;
    const running = st.kind === 'pomodoro' ? st.running : st.swRunning;
    if (el.querySelector(running ? '[data-act=start]' : '[data-act=pause]')) return draw(); // state changed (e.g. phase finished)
    const pomo = st.kind === 'pomodoro';
    c.textContent = pomo ? mmss(remaining()) : hms(swElapsed());
    el.querySelector('[data-ring]')?.setAttribute('stroke-dashoffset', ringOffset(prog(full(), remaining())));
    const d = el.querySelector('[data-done]');
    if (d) d.textContent = st.done;
  };
  listeners.add(tick);
  draw();
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    const m = e.target.closest('[data-mode]')?.dataset.mode;
    const k = e.target.closest('[data-kind]')?.dataset.kind;
    const pk = e.target.closest('[data-pick]');
    const ps = e.target.closest('[data-preset]')?.dataset.preset;
    if (a) { actions[a](); save(); draw(); }
    else if (k && k !== st.kind) { st.kind = k; save(); draw(); }
    else if (m && m !== st.mode) { flushPartial(); st.mode = m; st.running = false; st.left = full(); save(); draw(); }
    else if (pk) { st.task_id = pk.dataset.pick; save(); draw(); }
    else if (ps) { const was = full('focus'); st.cfg.focus = Number(ps); if (st.mode === 'focus' && !st.running && st.left === was) st.left = full(); save(); draw(); }
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

/* ------------------------------ study log ------------------------------ */
function studyLog(host, refresh) {
  const body = mount(host);
  const log = D.studyLog;
  const byDay = new Map();
  for (const l of log) byDay.set(l.date, (byDay.get(l.date) || 0) + l.minutes);
  const sumRange = (from, to) => log.filter((l) => l.date >= from && l.date <= to).reduce((a, l) => a + l.minutes, 0);
  const ws = weekStart(D.today);
  let streak = 0;
  for (let d = byDay.has(D.today) ? D.today : addDays(D.today, -1); byDay.has(d); d = addDays(d, -1)) streak++;
  const target = D.settings.general.dailyTargetMin;
  const subTotals = D.subjects.map((s) => ({ s, m: log.filter((l) => l.subject_id === s.id && l.date >= ws).reduce((a, l) => a + l.minutes, 0) })).filter((x) => x.m);
  const maxSub = Math.max(...subTotals.map((x) => x.m), 1);
  body.innerHTML = `
<div class="grid g2">
<section class="card"><h2>This week by subject</h2>${subTotals.length ? `<div class="bars">${subTotals.sort((a, b) => b.m - a.m).map((x) => `<div class="br"><span>${esc(x.s.name)}</span><div class="track"><div class="fill" style="width:${(x.m / maxSub) * 100}%"></div></div><span class="right">${dur(x.m)}</span></div>`).join('')}</div>` : empty('Nothing logged this week yet.')}</section>
<details class="card"><summary class="row between" style="cursor:pointer"><h2 style="margin:0">Add time manually</h2><span class="muted small">optional</span></summary><div style="margin-top:12px">
<form id="lf" class="fgrid" autocomplete="off">
  <label><span class="lab">Date</span><input type="date" name="date" value="${esc(D.today)}" max="${esc(D.today)}" required></label>
  <label><span class="lab">Subject</span><select name="subject_id"><option value="">—</option>${subjectOpts()}</select></label>
  <label><span class="lab">Hours</span><input type="number" name="h" min="0" max="23" value="1"></label>
  <label><span class="lab">Minutes</span><input type="number" name="m" min="0" max="59" step="5" value="0"></label>
  <label><span class="lab">Activity</span><select name="activity">${opts(ACTIVITIES.map((a) => [a, a]), 'Study')}</select></label>
  <label><span class="lab">Note</span><input name="note" maxlength="1000"></label>
  <div><button class="btn primary">Log time</button></div>
</form></div></details>
</div>
<section class="card"><h2>Recent entries</h2>${log.length ? `<div class="tablewrap scrollbox"><table><tbody>${[...log].reverse().slice(0, 25).map((l) => `<tr><td class="nowrap">${esc(l.date)}</td><td>${esc(l.subject_id ? subName(l.subject_id) : '—')}</td><td>${esc(l.activity || '')}</td><td class="num">${dur(l.minutes)}</td><td class="muted">${esc(l.note || '')}</td><td class="right"><button class="btn ghost small" data-dl="${l.id}" aria-label="Delete entry">✕</button></td></tr>`).join('')}</tbody></table></div>` : empty('No study time logged yet.')}</section>`;
  $('#lf', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const minutes = Number(f.h.value || 0) * 60 + Number(f.m.value || 0);
    try {
      await api('POST', '/api/log', { date: f.date.value, subject_id: f.subject_id.value, minutes, activity: f.activity.value, note: f.note.value });
      toast('Logged');
      await refresh();
    } catch (ex) { fail(ex); }
  });
  body.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-dl]');
    if (d) try { await api('DELETE', `/api/log/${d.dataset.dl}`); await refresh(); } catch (ex) { fail(ex); }
  });
}
