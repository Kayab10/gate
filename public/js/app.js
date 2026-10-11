import { D, api, load, $, esc, toast, fail, modalOpen, closeAllModals, mount, pickStream } from './util.js';
import { openMistakeForm, mistakeFormHtml, bindMistakeForm } from './form.js';
import { renderDashboard } from './dashboard.js';
import { renderMistakes } from './mistakes.js';
import { renderReview, resetReviewDate } from './review.js';
import { renderTests } from './tests.js';
import { renderSchedule } from './schedule.js';
import { renderAnalytics } from './analytics.js';
import { renderSettings } from './settings.js';
import { diffDays } from '/shared/dates.js';

const ROUTES = [
  ['dashboard', 'Dashboard', renderDashboard],
  ['add', 'Add mistake', renderAdd],
  ['mistakes', 'All mistakes', renderMistakes],
  ['review', 'Review queue', renderReview],
  ['tests', 'Tests & mocks', renderTests],
  ['schedule', 'Schedule & tracker', renderSchedule],
  ['analytics', 'Subject analytics', renderAnalytics],
  ['settings', 'Settings', renderSettings],
];

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  mistakes: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  review: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  tests: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 13l2 2 4-4"/>',
  schedule: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  analytics: '<path d="M3 3v18h18"/><path d="M8 16v-4M13 16V8M18 16v-7"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
};

let cleanup = null;
const main = $('#main');

function current() {
  const name = location.hash.replace(/^#\//, '') || 'dashboard';
  return ROUTES.find((r) => r[0] === name) || ROUTES[0];
}

function drawNav() {
  const dueN = D.live.filter((m) => m.status !== 'mastered' && m.next_review <= D.today).length;
  const cur = current()[0];
  $('#navList').innerHTML = ROUTES.map(([k, label]) => `<li><a class="nav" href="#/${k}"${k === cur ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ''}</svg><span class="lbl">${label}</span>${k === 'review' && dueN ? `<span class="pill" aria-label="${dueN} due">${dueN}</span>` : ''}</a></li>`).join('');
  $('#topTitle').textContent = current()[1];
  $('#userLine').textContent = D.user?.name || D.user?.email || '';
  $('#streamBtn').innerHTML = `<span><b>${esc(D.stream.code)}</b> · ${esc(D.stream.name)}</span><span>⇄</span>`;
  const exam = D.settings.general.examDate;
  $('#examCount').textContent = exam ? `${Math.max(0, diffDays(exam, D.today))} days to exam` : '';
}

function renderAdd(host, refresh) {
  const root = mount(host);
  root.innerHTML = `<div class="page-head"><div><h1>Add mistake</h1><p>Only <b>subject</b> and <b>primary cause</b> are required — fill in the rest now or later. <kbd>Ctrl+Enter</kbd> saves and keeps your context for the next one.</p></div></div><div class="card">${mistakeFormHtml({}, { detailed: true })}</div>`;
  // "save & add another" keeps the form (and its sticky context); just refresh the data behind it
  bindMistakeForm(root, { onSaved: (saved, act) => (act === 'again' ? load().then(drawNav) : refresh()) });
}

/** reload=false re-renders from the data already loaded */
export async function refresh(reload = true) {
  const y = window.scrollY;
  try {
    if (reload) await load();
    drawNav();
    cleanup?.();
    const [name, , fn] = current();
    cleanup = fn(main, refresh) || null;
    void name;
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

const animateIn = () => (main.classList.add('enter'), setTimeout(() => main.classList.remove('enter'), 400));
window.addEventListener('hashchange', () => {
  animateIn();
  closeAllModals();
  resetReviewDate();
  window.scrollTo(0, 0);
  refresh(true);
});

window.addEventListener('gate:stale', () => refresh());
$('#streamBtn').addEventListener('click', async () => {
  try {
    const r = await api('GET', '/api/streams');
    if (await pickStream(r.streams, r.available, { dismissable: true })) {
      location.hash = '#/dashboard';
      await refresh();
    }
  } catch (e) {
    fail(e);
  }
});
$('#quickAdd').addEventListener('click', () => openMistakeForm({ onSaved: () => refresh() }));
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches?.('input, textarea, select') && !modalOpen()) {
    e.preventDefault();
    openMistakeForm({ onSaved: () => refresh() });
  }
});
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'light';
  const t = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
});

// ---- mobile: slide-in menu ----
const setMenu = (open) => {
  document.body.classList.toggle('menu-open', open);
  $('#menuBtn').setAttribute('aria-expanded', String(open));
};
$('#menuBtn').addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
$('#scrim').addEventListener('click', () => setMenu(false));
$('#navList').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
window.addEventListener('hashchange', () => setMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
$('#topAdd').addEventListener('click', () => openMistakeForm({ onSaved: () => refresh() }));
$('#quickAdd').addEventListener('click', () => setMenu(false));
// swipe: right from the left edge opens, left closes
let sx = null, sy = null;
document.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (sx == null) return;
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
  const open = document.body.classList.contains('menu-open');
  if (dy < 40 && !open && sx < 24 && dx > 70) setMenu(true);
  else if (dy < 40 && open && dx < -60) setMenu(false);
  sx = null;
}, { passive: true });

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
void esc; void toast;
