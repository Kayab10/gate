import { D, api, load, $, esc, fail, modalOpen, closeAllModals, mount, pickStream, openModal } from './util.js';
import { renderToday } from './today.js';
import { renderTodo } from './todo.js';
import { renderTimer, runningInfo, onTick } from './timer.js';
import { renderConcepts, openConceptForm, dueConcepts } from './concepts.js';
import { renderTests } from './tests.js';
import { renderSettings } from './settings.js';
import { diffDays } from '/shared/dates.js';

// [route, label, render, shows in the bottom bar]
const ROUTES = [
  ['today', 'Today', renderToday],
  ['todo', 'To-do', renderTodo],
  ['timer', 'Timer', renderTimer],
  ['concepts', 'Concepts', renderConcepts],
  ['tests', 'Tests', renderTests],
  ['more', 'More', renderMore],
];

const ICONS = {
  today: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  todo: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  concepts: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  tests: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 13l2 2 4-4"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};

let cleanup = null;
const main = $('#main');

function current() {
  const name = location.hash.replace(/^#\//, '') || 'today';
  return ROUTES.find((r) => r[0] === name) || ROUTES[0];
}

function drawNav() {
  const dueN = dueConcepts().length;
  const cur = current()[0];
  const item = ([k, label]) => `<a class="nav" href="#/${k}"${k === cur ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span class="lbl">${label}</span>${k === 'concepts' && dueN ? `<span class="pill" aria-label="${dueN} due">${dueN}</span>` : ''}</a>`;
  $('#navList').innerHTML = ROUTES.map((r) => `<li>${item(r)}</li>`).join('');
  $('#bottomNav').innerHTML = ROUTES.map(item).join('');
  $('#topTitle').textContent = current()[1];
  $('#userLine').textContent = D.user?.name || D.user?.email || '';
  $('#streamBtn').innerHTML = `<span><b>${esc(D.stream.code)}</b> · ${esc(D.stream.name)}</span><span>⇄</span>`;
  const exam = D.settings.general.examDate;
  $('#examCount').textContent = exam ? `${Math.max(0, diffDays(exam, D.today))} days to exam` : '';
}

/** More: branch, theme, then the settings page. */
function renderMore(host, refresh) {
  const root = mount(host);
  root.innerHTML = `<div class="card"><div class="row"><button class="btn" id="moreStream">⇄ Branch: <b>${esc(D.stream.code)}</b></button><button class="btn" id="moreTheme">◐ Theme</button></div><p class="muted small" style="margin:8px 0 0">${esc(D.user?.name || D.user?.email || '')}</p></div><div id="settingsHost"></div>`;
  $('#moreStream', root).addEventListener('click', () => $('#streamBtn').click());
  $('#moreTheme', root).addEventListener('click', () => $('#themeBtn').click());
  return renderSettings($('#settingsHost', root), refresh);
}

/** reload=false re-renders from the data already loaded */
export async function refresh(reload = true) {
  const y = window.scrollY;
  try {
    if (reload) await load();
    drawNav();
    drawTimerBar();
    cleanup?.();
    const [, , fn] = current();
    cleanup = fn(main, refresh) || null;
    window.scrollTo(0, y);
  } catch (e) {
    fail(e);
    if (!D.loaded) {
      // nothing could be loaded at all (typically the database is not reachable): say so instead of showing a blank page
      main.innerHTML = `<div class="card" style="max-width:640px"><h2>Can’t load your data</h2><p class="pre">${esc(e.message)}</p><div class="row"><a class="btn" href="/api/health" target="_blank" rel="noopener">Run the connection check</a><button class="btn primary" id="retry">Try again</button></div></div>`;
      $('#retry').addEventListener('click', () => refresh());
    }
  }
}

// ---- running-timer bar: visible on every page except the Timer page itself ----
function drawTimerBar() {
  const bar = $('#timerBar');
  const info = D.loaded ? runningInfo() : null;
  if (!info || current()[0] === 'timer') return void (bar.hidden = true);
  bar.hidden = false;
  bar.innerHTML = `<a href="#/timer"><b data-t>${esc(info.text)}</b> <span>${esc(info.label)}${info.task ? ' · ' + esc(info.task.title) : ''}</span></a>`;
}
onTick(() => {
  const info = D.loaded ? runningInfo() : null;
  const bar = $('#timerBar');
  if (!info || current()[0] === 'timer') return void (bar.hidden = true);
  if (bar.hidden || !bar.querySelector('[data-t]')) return drawTimerBar();
  bar.querySelector('[data-t]').textContent = info.text;
});

const animateIn = () => (main.classList.add('enter'), setTimeout(() => main.classList.remove('enter'), 400));
window.addEventListener('hashchange', () => {
  animateIn();
  closeAllModals();
  window.scrollTo(0, 0);
  refresh(true);
});

window.addEventListener('gate:stale', () => refresh());
$('#streamBtn').addEventListener('click', async () => {
  try {
    const r = await api('GET', '/api/streams');
    if (await pickStream(r.streams, r.available, { dismissable: true })) {
      location.hash = '#/today';
      await refresh();
    }
  } catch (e) {
    fail(e);
  }
});

// ---- quick add: concept, test score or to-do ----
function quickAdd() {
  if (modalOpen()) return;
  const m = openModal('Quick add', `<div class="stack"><button class="btn wide" data-q="concept">💡 Concept</button><button class="btn wide" data-q="test">📝 Test score</button><button class="btn wide" data-q="todo">✅ To-do</button></div>`);
  m.dlg.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (!q) return;
    m.close();
    if (q === 'concept') return openConceptForm({ onSaved: () => refresh() });
    location.hash = q === 'test' ? '#/tests' : '#/todo';
    setTimeout(() => $(q === 'test' ? '#qt [name=marks_obtained]' : '#tf [name=title]')?.focus(), 450);
  });
}
$('#quickAdd').addEventListener('click', quickAdd);
$('#topAdd').addEventListener('click', quickAdd);
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches?.('input, textarea, select') && !modalOpen()) {
    e.preventDefault();
    quickAdd();
  }
});
const themeMeta = () => document.querySelector('meta[name=theme-color]')?.setAttribute('content', document.documentElement.dataset.theme === 'light' ? '#f4f5f9' : '#12141c');
themeMeta();
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'light';
  const t = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  themeMeta();
  try { localStorage.setItem('theme', t); } catch {}
});

// ---- mobile: wide tables become stacked cards (labels come from the header cells) ----
function labelTables() {
  main.querySelectorAll('.tablewrap > table:not([data-cards])').forEach((tb) => {
    const heads = [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (heads.length < 4) return;
    tb.dataset.cards = '1';
    tb.classList.add('cards');
    tb.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.l = heads[i]; }));
  });
}
new MutationObserver(labelTables).observe(main, { childList: true, subtree: true });

// If the page has been left open overnight, refresh the date-dependent data when it regains focus.
let lastDay = null;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && D.loaded && lastDay && lastDay !== new Date().toDateString() && !modalOpen()) refresh();
  lastDay = new Date().toDateString();
});
lastDay = new Date().toDateString();

animateIn();
refresh().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
