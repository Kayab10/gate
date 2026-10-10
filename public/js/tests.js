import { mount, D, esc, $, $$, api, opts, subjectOpts, subName, topName, causeName, toast, fail, openModal, confirmDialog, pct, num, empty, topicsOf } from './util.js';
import { testStats, repeatCount } from '/shared/analytics.js';
import { todayStr } from '/shared/dates.js';
import { lineChart, COLORS } from './charts.js';
import { openMistakeForm } from './form.js';
import { showMistake, snippet, statusBadge } from './mistakes.js';
import { setFilter } from './mistakes.js';

const TYPES = [['topic', 'Topic test'], ['subject', 'Subject test'], ['mock', 'Full mock'], ['pyq', 'PYQ set'], ['practice', 'Practice']];
const typeLabel = (t) => TYPES.find((x) => x[0] === t)?.[1] || '—';

export function renderTests(host, refresh) {
  const root = mount(host);
  const tests = [...D.tests].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const withScore = [...D.tests].filter((t) => testStats(t).scorePct != null).sort((a, b) => a.date.localeCompare(b.date));
  const providers = [...new Set(withScore.map((t) => t.provider || 'Unspecified'))];
  const labels = withScore.map((t) => t.date);

  root.innerHTML = `
<div class="page-head"><div><h1>Tests & mocks</h1><p>${tests.length} test(s) recorded</p></div><button class="btn primary" id="newTest">＋ New test</button></div>
${withScore.length >= 2 ? `<div class="card"><h2>Score trend</h2>${lineChart({ labels, bridge: true, yMax: 1, yFormat: (v) => `${Math.round(v * 100)}%`, ariaLabel: 'Score percentage by test', series: providers.map((p, i) => ({ name: p, color: COLORS[i % COLORS.length], values: withScore.map((t) => ((t.provider || 'Unspecified') === p ? testStats(t).scorePct : null)) })) })}
  <div class="notice">Scores from different providers are not directly comparable — each provider calibrates difficulty differently. Compare within one provider's series first.</div></div>` : ''}
${tests.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Test</th><th>Provider</th><th>Type</th><th class="num">Score</th><th class="num" title="correct ÷ (correct + incorrect)">Acc. (attempted)</th><th class="num" title="correct ÷ total questions">Acc. (all)</th><th class="num">Neg.</th><th class="num">Mistakes</th></tr></thead><tbody>${tests.map((t) => {
    const st = testStats(t);
    const n = D.mistakes.filter((m) => m.test_id === t.id && !m.archived).length;
    return `<tr class="click" data-id="${t.id}"><td class="nowrap">${esc(t.date)}</td><td>${esc(t.name)}</td><td>${esc(t.provider || '—')}</td><td>${typeLabel(t.type)}</td><td class="num">${t.marks_obtained != null ? `${num(t.marks_obtained, 2)}${t.total_marks ? ' / ' + num(t.total_marks) : ''}` : '—'}</td><td class="num">${pct(st.accuracyAttempted)}</td><td class="num">${pct(st.accuracyAll)}</td><td class="num">${t.negative_marks != null ? num(t.negative_marks, 2) : '—'}</td><td class="num">${n}</td></tr>`;
  }).join('')}</tbody></table></div>` : empty('No tests yet. Add a test to track scores and link its mistakes.')}`;

  $('#newTest', root).addEventListener('click', () => openTestForm(null, refresh));
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) showTest(Number(tr.dataset.id), refresh);
  });
}

export function openTestForm(t, refresh) {
  const x = t || { date: todayStr(), breakdown: [] };
  const rows = (x.breakdown || []).map((b) => ({ ...b }));
  const rowHtml = (b, i) => `<tr data-i="${i}"><td><select data-f="subject_id">${subjectOpts(b.subject_id, 'Subject')}</select></td><td><select data-f="topic_id"><option value="">All topics</option>${opts((b.subject_id ? topicsOf(b.subject_id) : []).map((tp) => [tp.id, tp.name]), b.topic_id)}</select></td><td><input data-f="correct" type="number" min="0" value="${b.correct ?? ''}" style="width:70px" aria-label="Correct"></td><td><input data-f="incorrect" type="number" min="0" value="${b.incorrect ?? ''}" style="width:70px" aria-label="Incorrect"></td><td><button type="button" class="btn ghost small" data-rm="${i}" aria-label="Remove row">✕</button></td></tr>`;
  const f = (name, label, type = 'text', extra = '') => `<label><span class="lab">${label}</span><input name="${name}" type="${type}" value="${esc(x[name] ?? '')}" ${extra}></label>`;
  const m = openModal(t ? 'Edit test' : 'New test', `<form autocomplete="off"><div class="fgrid">
    ${f('name', 'Test name *', 'text', 'required')}${f('provider', 'Provider / series')}${f('date', 'Date *', 'date', 'required')}
    <label><span class="lab">Type</span><select name="type"><option value="">—</option>${opts(TYPES, x.type)}</select></label>
    ${f('duration_min', 'Duration (min)', 'number', 'min="0" step="1"')}${f('total_questions', 'Total questions', 'number', 'min="0"')}${f('total_marks', 'Total marks', 'number', 'min="0" step="0.01"')}${f('marks_obtained', 'Marks obtained', 'number', 'step="0.01"')}
    ${f('correct', 'Correct', 'number', 'min="0"')}${f('incorrect', 'Incorrect', 'number', 'min="0"')}${f('unattempted', 'Unattempted', 'number', 'min="0"')}${f('negative_marks', 'Negative marks (total deducted)', 'number', 'min="0" step="0.01"')}
  </div>
  <h3 style="margin-top:14px">Subject / topic breakdown <span class="muted small">(optional — powers accuracy and topic mastery)</span></h3>
  <table><thead><tr><th>Subject</th><th>Topic</th><th>Correct</th><th>Incorrect</th><th></th></tr></thead><tbody id="brk">${rows.map(rowHtml).join('')}</tbody></table>
  <button type="button" class="btn small" id="addRow">＋ Add row</button>
  <label style="margin-top:12px"><span class="lab">Post-test analysis notes</span><textarea name="notes" rows="4">${esc(x.notes)}</textarea></label>
  <p class="err" data-err></p>
  <div class="row"><button class="btn primary">${t ? 'Save changes' : 'Create test'}</button>${t ? '<button type="button" class="btn danger" id="delT" style="margin-left:auto">Delete test</button>' : ''}</div></form>`, { wide: true });

  const brk = $('#brk', m.dlg);
  const redraw = () => (brk.innerHTML = rows.map(rowHtml).join(''));
  $('#addRow', m.dlg).addEventListener('click', () => (rows.push({}), redraw()));
  brk.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) (rows.splice(Number(rm.dataset.rm), 1), redraw());
  });
  brk.addEventListener('change', (e) => {
    const i = Number(e.target.closest('tr').dataset.i), k = e.target.dataset.f;
    rows[i][k] = e.target.value === '' ? undefined : Number(e.target.value);
    if (k === 'subject_id') (delete rows[i].topic_id, redraw());
  });
  $('form', m.dlg).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = e.target.elements;
    const p = {};
    for (const k of ['name', 'provider', 'date', 'type', 'duration_min', 'total_questions', 'total_marks', 'marks_obtained', 'correct', 'incorrect', 'unattempted', 'negative_marks', 'notes']) p[k] = fd[k].value;
    p.breakdown = rows.filter((r) => r.subject_id);
    try {
      const saved = t ? await api('PUT', `/api/tests/${t.id}`, p) : await api('POST', '/api/tests', p);
      toast('Test saved');
      m.close();
      await refresh();
      if (!t) showTest(saved.id, refresh);
    } catch (ex) { $('[data-err]', m.dlg).textContent = ex.message; }
  });
  $('#delT', m.dlg)?.addEventListener('click', async () => {
    const n = D.mistakes.filter((q) => q.test_id === t.id).length;
    if (await confirmDialog(`Delete test “${t.name}”?${n ? `\n\n${n} linked mistake(s) are kept (they keep the test name but lose the link).` : ''}`)) {
      try { await api('DELETE', `/api/tests/${t.id}`); m.close(); toast('Test deleted'); await refresh(); } catch (ex) { fail(ex); }
    }
  });
}

let reviewFilter = 'all';
export function showTest(id, refresh) {
  const t = D.testMap.get(id);
  if (!t) return;
  const st = testStats(t);
  const earlier = (m) => m.topic_id && D.mistakes.some((o) => o.id !== m.id && !o.archived && o.topic_id === m.topic_id && o.test_id && o.test_id !== t.id && (D.testMap.get(o.test_id)?.date || '9') < t.date);
  const FILTERS = {
    all: ['All incorrect', () => true],
    guessed: ['Guessed', (m) => m.guessed],
    skipped: ['Skipped though solvable', (m) => m.skipped_solvable],
    slow: [`Slow (> ${D.settings.general.slowSeconds}s)`, (m) => m.time_spent_sec != null && m.time_spent_sec > D.settings.general.slowSeconds],
    repeated: ['Repeated before', (m) => repeatCount(m) > 0 || earlier(m)],
  };
  const linked = D.mistakes.filter((m) => m.test_id === id && !m.archived);
  const row = (k, v) => (v == null || v === '' ? '' : `<tr><td class="muted">${k}</td><td>${v}</td></tr>`);
  const draw = () => {
    const list = linked.filter(FILTERS[reviewFilter][1]);
    $('#tl', m.dlg).innerHTML = list.length
      ? `<div class="tablewrap"><table><tbody>${list.map((q) => `<tr class="click" data-m="${q.id}"><td>${esc(q.question_no ? 'Q' + q.question_no : '#' + q.id)}</td><td>${esc(subName(q.subject_id))}<div class="muted small">${esc(topName(q.topic_id))}</div></td><td class="clip">${esc(snippet(q))}</td><td>${esc(causeName(q.cause_primary))}</td><td>${statusBadge(q)}</td><td>${[q.guessed && '🎲', q.skipped_solvable && '⏭', earlier(q) && '↺'].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody></table></div>`
      : empty(linked.length ? 'No mistakes match this filter.' : 'No mistakes linked yet — add them below.');
  };
  const last = D.mistakes.filter((x) => x.test_id === id).sort((a, b) => b.id - a.id)[0];
  const m = openModal(t.name, `
<div class="row between"><span class="muted">${esc(t.date)} · ${esc(t.provider || 'no provider')} · ${typeLabel(t.type)}${t.duration_min ? ` · ${t.duration_min} min` : ''}</span><button class="btn small" id="editT">Edit test</button></div>
<div class="tiles" style="margin-top:10px">
  <div class="tile"><div class="v">${t.marks_obtained != null ? num(t.marks_obtained, 2) : '—'}<span class="muted small"> ${t.total_marks ? '/ ' + num(t.total_marks) : ''}</span></div><div class="l">Score${st.scorePct != null ? ' · ' + pct(st.scorePct, 1) : ''}</div></div>
  <div class="tile" title="correct ÷ (correct + incorrect)"><div class="v">${pct(st.accuracyAttempted)}</div><div class="l">Accuracy among attempted</div></div>
  <div class="tile" title="correct ÷ total questions (needs total questions)"><div class="v">${pct(st.accuracyAll)}</div><div class="l">Accuracy among all questions</div></div>
  <div class="tile"><div class="v">${pct(st.attemptRate)}</div><div class="l">Attempt rate</div></div>
</div>
<table><tbody>${row('Correct / incorrect / unattempted', [t.correct, t.incorrect, st.unattempted].map((v) => (v == null ? '?' : v)).join(' / '))}${row('Negative marks', t.negative_marks != null ? num(t.negative_marks, 2) : '')}</tbody></table>
${(t.breakdown || []).length ? `<h3 style="margin-top:12px">Breakdown</h3><table><thead><tr><th>Subject</th><th>Topic</th><th class="num">Correct</th><th class="num">Incorrect</th><th class="num">Accuracy</th></tr></thead><tbody>${t.breakdown.map((b) => { const a = (b.correct || 0) + (b.incorrect || 0); return `<tr><td>${esc(subName(b.subject_id))}</td><td>${esc(b.topic_id ? topName(b.topic_id) : 'All')}</td><td class="num">${b.correct ?? '—'}</td><td class="num">${b.incorrect ?? '—'}</td><td class="num">${a ? pct((b.correct || 0) / a) : '—'}</td></tr>`; }).join('')}</tbody></table>` : ''}
${t.notes ? `<h3 style="margin-top:12px">Analysis notes</h3><p class="pre">${esc(t.notes)}</p>` : ''}
<h3 style="margin-top:14px">Mock review — mistakes in this test (${linked.length})</h3>
<div class="row" id="tf">${Object.entries(FILTERS).map(([k, [l]]) => `<label class="chip"><input type="radio" name="tf" value="${k}"${reviewFilter === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
<p class="hint">🎲 guessed · ⏭ skipped though solvable · ↺ same topic wrong in an earlier test</p>
<div id="tl"></div>
<h3 style="margin-top:14px">Add a mistake from this test</h3>
<form id="qa" class="row" autocomplete="off">
  <input name="q" placeholder="Q no." style="width:80px" aria-label="Question number">
  <select name="s" required aria-label="Subject">${subjectOpts(last?.subject_id, 'Subject *')}</select>
  <select name="c" required aria-label="Primary cause"><option value="">Cause *</option>${opts(D.causes.map((c) => [c.id, c.name]), last?.cause_primary)}</select>
  <input name="l" type="number" step="0.33" min="0" placeholder="Marks lost" style="width:100px" aria-label="Marks lost">
  <label class="row gap-s"><input type="checkbox" name="g"> Guessed</label>
  <button class="btn primary">Add</button><button type="button" class="btn" id="qaFull">Full form…</button>
</form>
<div class="row" style="margin-top:12px"><button class="btn small" id="allM">Open all in Mistakes list</button></div>`, { wide: true });
  draw();
  $('#editT', m.dlg).addEventListener('click', () => (m.close(), openTestForm(t, refresh)));
  $('#tf', m.dlg).addEventListener('change', (e) => ((reviewFilter = e.target.value), draw()));
  $('#tl', m.dlg).addEventListener('click', (e) => {
    const tr = e.target.closest('[data-m]');
    if (tr) (m.close(), showMistake(Number(tr.dataset.m), refresh));
  });
  $('#qaFull', m.dlg).addEventListener('click', () => {
    const f = $('#qa', m.dlg).elements;
    openMistakeForm({ prefill: { test_id: id, test_name: t.name, provider: t.provider, test_type: t.type, date_encountered: t.date, question_no: f.q.value, subject_id: Number(f.s.value) || undefined, cause_primary: Number(f.c.value) || undefined, marks_lost: f.l.value || undefined, guessed: f.g.checked }, detailed: true, onSaved: async () => { await refresh(); } });
  });
  $('#qa', m.dlg).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('POST', '/api/mistakes', { test_id: id, date_encountered: t.date, question_no: f.q.value, subject_id: Number(f.s.value), cause_primary: Number(f.c.value), marks_lost: f.l.value, guessed: f.g.checked });
      toast('Added to this test');
      m.close();
      await refresh();
      showTest(id, refresh);
    } catch (ex) { fail(ex); }
  });
  $('#allM', m.dlg).addEventListener('click', () => (setFilter({ test: id }), m.close(), (location.hash = '#/mistakes')));
  void $$;
}
