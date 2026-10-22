// Tests: just the marks. Four tiers (weekly quiz → topic → subject → full mock), with progress per tier.
import { mount, D, esc, $, $$, api, opts, toast, fail, openModal, confirmDialog, pct, num, empty } from './util.js';
import { testStats } from '/shared/analytics.js';
import { todayStr, shortDate } from '/shared/dates.js';
import { lineChart, COLORS } from './charts.js';
import { openConceptForm } from './concepts.js';

export const TIERS = [['weekly', 'Weekly quiz'], ['topic', 'Topic-wise'], ['subject', 'Subject-wise'], ['mock', 'Full mock']];
const tierOf = (t) => t.tier || (t.type === 'topic' ? 'topic' : t.type === 'subject' ? 'subject' : 'mock');
const tierLabel = (k) => TIERS.find((x) => x[0] === k)?.[1] || k;
const scoreOf = (t) => testStats(t).scorePct;

let tab = '';

export function renderTests(host, refresh) {
  const root = mount(host);
  const all = [...D.tests].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const shown = tab ? all.filter((t) => tierOf(t) === tab) : all;
  const scored = (list) => list.filter((t) => scoreOf(t) != null);
  const tierStats = TIERS.map(([k, l]) => {
    const s = scored(all.filter((t) => tierOf(t) === k)); // newest first
    const last3 = s.slice(0, 3);
    return { k, l, n: all.filter((t) => tierOf(t) === k).length, latest: s[0] ? scoreOf(s[0]) : null, best: s.length ? Math.max(...s.map(scoreOf)) : null, avg3: last3.length ? last3.reduce((a, t) => a + scoreOf(t), 0) / last3.length : null };
  });
  const chartTests = scored(all).reverse(); // oldest first
  const tiersWithData = TIERS.filter(([k]) => scored(all).some((t) => tierOf(t) === k));

  root.innerHTML = `
<div class="page-head"><div><h1>Tests</h1><p>${all.length} recorded</p></div></div>
<form id="qt" class="card" autocomplete="off">
  <div class="chips" role="radiogroup">${TIERS.map(([k, l], i) => `<label class="chip"><input type="radio" name="tier" value="${k}"${(tab || 'weekly') === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
  <div class="fgrid" style="margin-top:10px">
    <label><span class="lab">Marks obtained *</span><input name="marks_obtained" type="number" step="0.01" required></label>
    <label><span class="lab">Out of *</span><input name="total_marks" type="number" step="0.01" min="0" value="${esc(lastTotal())}" required></label>
    <label><span class="lab">Name (optional)</span><input name="name" maxlength="300" placeholder="e.g. Weekly Quiz 12"></label>
    <label><span class="lab">Date</span><input name="date" type="date" value="${esc(todayStr())}" required></label>
  </div>
  <details class="more" style="margin-top:8px"><summary>Platform and link</summary><div class="fgrid" style="margin-top:8px">
    <label><span class="lab">Platform</span><input name="provider" list="plat" placeholder="GO Classes, other…"><datalist id="plat">${[...new Set(D.tests.map((t) => t.provider).filter(Boolean))].map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
    <label><span class="lab">Link (optional)</span><input name="url" type="url" placeholder="https://…"></label>
  </div></details>
  <p class="err" data-err></p><div class="row" style="margin-top:8px"><button class="btn primary">Save score</button></div>
</form>

<div class="tiles">${tierStats.map((s) => `<div class="tile" data-tier="${s.k}" style="cursor:pointer"><div class="v">${pct(s.latest)}</div><div class="l">${s.l} · latest${s.n ? ` · ${s.n} test${s.n > 1 ? 's' : ''}` : ''}</div>${s.n ? `<div class="muted small">best ${pct(s.best)} · last-3 avg ${pct(s.avg3)}</div>` : ''}</div>`).join('')}</div>

${chartTests.length >= 2 ? `<div class="card"><h2>Progress</h2>${lineChart({ labels: chartTests.map((t) => t.date), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, ariaLabel: 'Score percentage by test', series: tiersWithData.map(([k, l], i) => ({ name: l, color: COLORS[TIERS.findIndex((x) => x[0] === k) % COLORS.length], values: chartTests.map((t) => (tierOf(t) === k ? scoreOf(t) : null)) })) })}
  <div class="row" style="margin-top:6px">${tiersWithData.map(([k, l]) => `<span class="badge"><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[TIERS.findIndex((x) => x[0] === k) % COLORS.length]}"></i> ${l}</span>`).join('')}</div></div>` : ''}

<div class="tabs" role="tablist">${[['', 'All'], ...TIERS].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
${shown.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Test</th><th>Tier</th><th class="num">Marks</th><th class="num">%</th><th></th></tr></thead><tbody>${shown.map((t) => `<tr class="click" data-id="${t.id}"><td class="nowrap">${esc(t.date)}</td><td>${esc(t.name)}${t.provider ? `<div class="muted small">${esc(t.provider)}</div>` : ''}</td><td>${esc(tierLabel(tierOf(t)))}</td><td class="num">${t.marks_obtained != null ? `${num(t.marks_obtained, 2)}${t.total_marks ? ' / ' + num(t.total_marks) : ''}` : '—'}</td><td class="num">${pct(scoreOf(t), 0)}</td><td class="right">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-link aria-label="Open test link">↗</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No tests here yet. Enter a score above.')}`;

  const form = $('#qt', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const tier = form.querySelector('[name=tier]:checked').value;
    try {
      await api('POST', '/api/tests', { tier, name: f.name.value.trim() || `${tierLabel(tier)} · ${shortDate(f.date.value)}`, date: f.date.value, marks_obtained: f.marks_obtained.value, total_marks: f.total_marks.value, provider: f.provider.value, url: f.url.value });
      toast('Score saved');
      await refresh();
    } catch (ex) { $('[data-err]', form).textContent = ex.message; }
  });
  root.addEventListener('click', (e) => {
    const tab2 = e.target.closest('[data-tab]');
    if (tab2) return ((tab = tab2.dataset.tab), renderTests(host, refresh));
    const tile = e.target.closest('[data-tier]');
    if (tile) return ((tab = tile.dataset.tier), renderTests(host, refresh));
    if (e.target.closest('[data-link]')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openTest(D.testMap.get(Number(tr.dataset.id)), refresh);
  });
}
const lastTotal = () => { const t = [...D.tests].reverse().find((x) => x.total_marks); return t?.total_marks ?? ''; };

function openTest(t, refresh) {
  if (!t) return;
  const f = (name, label, type = 'text', extra = '') => `<label><span class="lab">${label}</span><input name="${name}" type="${type}" value="${esc(t[name] ?? '')}" ${extra}></label>`;
  const m = openModal(t.name, `<form autocomplete="off"><div class="fgrid">
    ${f('name', 'Name', 'text', 'required')}
    <label><span class="lab">Tier</span><select name="tier">${opts(TIERS, tierOf(t))}</select></label>
    ${f('date', 'Date', 'date', 'required')}${f('provider', 'Platform')}
    ${f('marks_obtained', 'Marks obtained', 'number', 'step="0.01"')}${f('total_marks', 'Out of', 'number', 'min="0" step="0.01"')}
    <label class="full"><span class="lab">Link</span><input name="url" type="url" value="${esc(t.url ?? '')}"></label>
    <label class="full"><span class="lab">Notes</span><textarea name="notes" rows="3">${esc(t.notes)}</textarea></label>
  </div>
  <details class="more" style="margin-top:8px"><summary>Extra detail (optional)</summary><div class="fgrid" style="margin-top:8px">
    ${f('correct', 'Correct', 'number', 'min="0"')}${f('incorrect', 'Incorrect', 'number', 'min="0"')}${f('total_questions', 'Total questions', 'number', 'min="0"')}${f('duration_min', 'Duration (min)', 'number', 'min="0"')}
  </div></details>
  <p class="err" data-err></p>
  <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="addC">＋ Concept from this test</button><button type="button" class="btn danger" id="delT" style="margin-left:auto">Delete</button></div></form>`);
  $('form', m.dlg).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = e.target.elements;
    const p = {};
    for (const k of ['name', 'tier', 'date', 'provider', 'marks_obtained', 'total_marks', 'url', 'notes', 'correct', 'incorrect', 'total_questions', 'duration_min']) p[k] = fd[k].value;
    try { await api('PUT', `/api/tests/${t.id}`, p); toast('Saved'); m.close(); await refresh(); } catch (ex) { $('[data-err]', m.dlg).textContent = ex.message; }
  });
  $('#addC', m.dlg).addEventListener('click', () => { m.close(); openConceptForm({ prefill: { test_id: t.id }, onSaved: () => refresh() }); });
  $('#delT', m.dlg).addEventListener('click', async () => {
    if (await confirmDialog(`Delete “${t.name}”? Concepts linked to it are kept.`)) {
      try { await api('DELETE', `/api/tests/${t.id}`); m.close(); toast('Deleted'); await refresh(); } catch (ex) { fail(ex); }
    }
  });
}
