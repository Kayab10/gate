// Tests: marks plus the question breakdown. Four tiers (weekly quiz → topic → subject → full mock) and two series.
import { mount, D, esc, $, api, opts, toast, fail, openModal, confirmDialog, pct, num, empty } from './util.js';
import { testStats } from '/shared/analytics.js';
import { todayStr, shortDate } from '/shared/dates.js';
import { lineChart, COLORS } from './charts.js';
import { openConceptForm } from './concepts.js';

export const TIERS = [['weekly', 'Weekly quiz'], ['topic', 'Topic-wise'], ['subject', 'Subject-wise'], ['mock', 'Full mock']];
export const SERIES = ['GO Classes', 'TAAI'];
const tierOf = (t) => t.tier || (t.type === 'topic' ? 'topic' : t.type === 'subject' ? 'subject' : 'mock');
const tierLabel = (k) => TIERS.find((x) => x[0] === k)?.[1] || k;
const scoreOf = (t) => testStats(t).scorePct;

let tab = '';
let series = '';
let lastSeries = '';

/** Shared field block for the quick-add form and the edit dialog. */
function fieldsHtml(x = {}) {
  const prov = x.provider && !SERIES.includes(x.provider) ? [x.provider] : [];
  const f = (name, label, type = 'number', extra = '') => `<label><span class="lab">${label}</span><input name="${name}" type="${type}" value="${esc(x[name] ?? '')}" ${extra}></label>`;
  return `<div class="fgrid">
    <label><span class="lab">Series *</span><select name="provider" required>${opts([...SERIES, ...prov].map((p) => [p, p]), x.provider || lastSeries || SERIES[0])}</select></label>
    <label><span class="lab">Name (optional)</span><input name="name" maxlength="300" value="${esc(x.name)}" placeholder="e.g. Weekly Quiz 12"></label>
    <label><span class="lab">Date *</span><input name="date" type="date" value="${esc(x.date || todayStr())}" required></label>
    ${f('marks_obtained', 'Marks obtained *', 'number', 'step="0.01" required')}
    ${f('total_marks', 'Out of (total marks) *', 'number', 'step="0.01" min="0" required')}
    ${f('negative_marks', 'Negative marks (overall)', 'number', 'step="0.01" min="0" placeholder="e.g. 2.67"')}
  </div>
  <h3 style="margin:14px 0 8px">Questions</h3>
  <div class="fgrid">
    ${f('total_questions', 'Total questions', 'number', 'min="0"')}
    ${f('correct', 'Correct', 'number', 'min="0"')}
    ${f('incorrect', 'Wrong', 'number', 'min="0"')}
    ${f('unattempted', 'Unattempted', 'number', 'min="0" placeholder="auto"')}
  </div>
  <p class="hint" data-calc style="margin:8px 0 0"></p>`;
}

/** Fill "unattempted" from the other counts and show a live summary. */
function bindCalc(form) {
  const f = form.elements;
  const n = (k) => (f[k].value === '' ? null : Number(f[k].value));
  let manual = f.unattempted.value !== '';
  f.unattempted.addEventListener('input', () => (manual = f.unattempted.value !== ''));
  const calc = () => {
    const tq = n('total_questions'), c = n('correct'), w = n('incorrect');
    if (!manual && tq != null && c != null && w != null) f.unattempted.value = Math.max(0, tq - c - w);
    const att = (c ?? 0) + (w ?? 0);
    const bits = [];
    if (c != null && w != null && att) bits.push(`attempted ${att}`, `accuracy ${Math.round((c / att) * 100)}%`);
    if (tq != null && c != null && w != null && c + w > tq) bits.push('⚠ correct + wrong is more than total questions');
    const nm = n('negative_marks'), mo = n('marks_obtained');
    if (nm != null && mo != null) bits.push(`gross ${num(mo + nm, 2)} − ${num(nm, 2)} negative = net ${num(mo, 2)}`);
    form.querySelector('[data-calc]').textContent = bits.join(' · ');
  };
  form.addEventListener('input', calc);
  calc();
}

const payload = (form, extra = {}) => {
  const f = form.elements;
  const p = { ...extra };
  for (const k of ['name', 'date', 'provider', 'marks_obtained', 'total_marks', 'negative_marks', 'total_questions', 'correct', 'incorrect', 'unattempted']) p[k] = f[k].value;
  return p;
};

export function renderTests(host, refresh) {
  const root = mount(host);
  const everything = [...D.tests].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const providers = [...new Set([...SERIES, ...D.tests.map((t) => t.provider).filter(Boolean)])];
  const all = series ? everything.filter((t) => (t.provider || '') === series) : everything;
  const shown = tab ? all.filter((t) => tierOf(t) === tab) : all;
  const scored = (list) => list.filter((t) => scoreOf(t) != null);
  const tierStats = TIERS.map(([k, l]) => {
    const mine = all.filter((t) => tierOf(t) === k);
    const s = scored(mine); // newest first
    const last3 = s.slice(0, 3);
    return { k, l, n: mine.length, latest: s[0] ? scoreOf(s[0]) : null, best: s.length ? Math.max(...s.map(scoreOf)) : null, avg3: last3.length ? last3.reduce((a, t) => a + scoreOf(t), 0) / last3.length : null };
  });
  const chartTests = scored(all).reverse(); // oldest first
  const tiersWithData = TIERS.filter(([k]) => chartTests.some((t) => tierOf(t) === k));

  root.innerHTML = `
<div class="page-head"><div><h1>Tests</h1><p>${all.length} recorded${series ? ` · ${esc(series)}` : ''}</p></div>
  <label class="row gap-s"><span class="muted small">Series</span><select id="fseries" aria-label="Filter by series"><option value="">All series</option>${opts(providers.map((p) => [p, p]), series)}</select></label></div>
<form id="qt" class="card" autocomplete="off">
  <div class="chips" role="radiogroup" style="margin-bottom:12px">${TIERS.map(([k, l]) => `<label class="chip"><input type="radio" name="tier" value="${k}"${(tab || 'weekly') === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
  ${fieldsHtml({ total_marks: lastTotal() })}
  <details class="more" style="margin-top:10px"><summary>Link (optional)</summary><div style="margin-top:8px"><input name="url" type="url" placeholder="https://… (test page)" style="width:100%"></div></details>
  <p class="err" data-err></p><div class="row" style="margin-top:8px"><button class="btn primary">Save score</button></div>
</form>

<div class="tiles">${tierStats.map((s) => `<div class="tile${tab === s.k ? ' on' : ''}" data-tier="${s.k}" style="cursor:pointer"><div class="v">${pct(s.latest)}</div><div class="l">${s.l} · latest${s.n ? ` · ${s.n} test${s.n > 1 ? 's' : ''}` : ''}</div>${s.n ? `<div class="muted small">best ${pct(s.best)} · last-3 avg ${pct(s.avg3)}</div>` : ''}</div>`).join('')}</div>

${chartTests.length >= 2 ? `<div class="card"><h2>Progress</h2>${lineChart({ labels: chartTests.map((t) => t.date), bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, ariaLabel: 'Score percentage by test', series: tiersWithData.map(([k, l]) => ({ name: l, color: COLORS[TIERS.findIndex((x) => x[0] === k) % COLORS.length], values: chartTests.map((t) => (tierOf(t) === k ? scoreOf(t) : null)) })) })}</div>` : ''}

<div class="tabs" role="tablist">${[['', 'All'], ...TIERS].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
${shown.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Test</th><th>Tier</th><th class="num">Marks</th><th class="num">%</th><th class="num" title="correct / wrong / unattempted">✓ / ✗ / –</th><th class="num">Neg.</th><th></th></tr></thead><tbody>${shown.map((t) => {
    const st = testStats(t);
    return `<tr class="click" data-id="${t.id}"><td class="nowrap">${esc(t.date)}</td><td>${esc(t.name)}${t.provider ? `<div class="muted small">${esc(t.provider)}</div>` : ''}</td><td>${esc(tierLabel(tierOf(t)))}</td><td class="num">${t.marks_obtained != null ? `${num(t.marks_obtained, 2)}${t.total_marks ? ' / ' + num(t.total_marks) : ''}` : '—'}</td><td class="num">${pct(scoreOf(t), 0)}</td><td class="num">${t.correct != null || t.incorrect != null ? `${t.correct ?? '–'} / ${t.incorrect ?? '–'} / ${st.unattempted ?? '–'}` : '—'}</td><td class="num">${t.negative_marks != null ? '−' + num(t.negative_marks, 2) : '—'}</td><td class="right">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-link aria-label="Open test link">↗</a>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>` : empty('No tests here yet. Enter a score above.')}`;

  const form = $('#qt', root);
  bindCalc(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tier = form.querySelector('[name=tier]:checked').value;
    const p = payload(form, { tier, url: form.elements.url.value });
    p.name = p.name.trim() || `${tierLabel(tier)} · ${shortDate(p.date)}`;
    try {
      lastSeries = p.provider;
      await api('POST', '/api/tests', p);
      toast('Score saved');
      await refresh();
    } catch (ex) { $('[data-err]', form).textContent = ex.message; }
  });
  $('#fseries', root).addEventListener('change', (e) => ((series = e.target.value), renderTests(host, refresh)));
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
  const m = openModal(t.name, `<form autocomplete="off">
    <label style="margin-bottom:12px"><span class="lab">Tier</span><select name="tier">${opts(TIERS, tierOf(t))}</select></label>
    ${fieldsHtml(t)}
    <label style="margin-top:12px"><span class="lab">Link</span><input name="url" type="url" value="${esc(t.url ?? '')}"></label>
    <label style="margin-top:12px"><span class="lab">Notes</span><textarea name="notes" rows="3">${esc(t.notes)}</textarea></label>
  <p class="err" data-err></p>
  <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="addC">＋ Concept from this test</button><button type="button" class="btn danger" id="delT" style="margin-left:auto">Delete</button></div></form>`, { wide: true });
  const form = $('form', m.dlg);
  bindCalc(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = payload(form, { tier: form.elements.tier.value, url: form.elements.url.value, notes: form.elements.notes.value });
    try { await api('PUT', `/api/tests/${t.id}`, p); toast('Saved'); m.close(); await refresh(); } catch (ex) { $('[data-err]', m.dlg).textContent = ex.message; }
  });
  $('#addC', m.dlg).addEventListener('click', () => { m.close(); openConceptForm({ prefill: { test_id: t.id }, onSaved: () => refresh() }); });
  $('#delT', m.dlg).addEventListener('click', async () => {
    if (await confirmDialog(`Delete “${t.name}”? Concepts linked to it are kept.`)) {
      try { await api('DELETE', `/api/tests/${t.id}`); m.close(); toast('Deleted'); await refresh(); } catch (ex) { fail(ex); }
    }
  });
}
