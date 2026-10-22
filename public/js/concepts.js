// Concepts: things you struggled with, must remember, or discovered in an exam. Each one is resurfaced on a spaced schedule.
import { mount, D, esc, $, $$, api, opts, subjectOpts, subName, topName, toast, fail, empty, openModal, confirmDialog, debounce, STATUS_BADGE, topicsOf } from './util.js';
import { previewOutcomes, displayStatus, STATUS_LABELS } from '/shared/srs.js';
import { diffDays, todayStr } from '/shared/dates.js';

export const KINDS = { struggle: ['🔴', 'Struggled with'], remember: ['🟡', 'Must remember'], new: ['🟢', 'New / unique'] };
const kindBadge = (k) => `<span class="badge">${KINDS[k]?.[0] || ''} ${esc(KINDS[k]?.[1] || '')}</span>`;
const statusBadge = (m) => { const s = displayStatus(m, D.today); return `<span class="badge ${STATUS_BADGE[s] || ''}">${esc(STATUS_LABELS[s])}</span>`; };
const dueLabel = (m) => {
  if (m.status === 'mastered') return `<span class="muted">maintenance ${esc(m.next_review)}</span>`;
  const d = diffDays(m.next_review, D.today);
  return `<span class="${d < 0 ? 'badge bad' : d === 0 ? 'badge warn' : 'muted'}" title="${esc(m.next_review)}">${d < 0 ? `${-d}d overdue` : d === 0 ? 'due today' : `in ${d}d`}</span>`;
};

export const dueConcepts = () => D.live.filter((m) => m.status !== 'mastered' && m.next_review <= D.today).sort((a, b) => a.next_review.localeCompare(b.next_review));

/* ------------------------------ form ------------------------------ */
export function conceptFormHtml(c = {}, { editing = false } = {}) {
  const topics = c.subject_id ? topicsOf(c.subject_id) : [];
  const tests = [...D.tests].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  return `<form class="cform" autocomplete="off" novalidate>
  <label><span class="lab">Concept *</span><input name="title" value="${esc(c.title)}" maxlength="200" placeholder="e.g. Bayes theorem with 3 priors" required></label>
  <div class="chips" role="radiogroup" style="margin:10px 0">${Object.entries(KINDS).map(([k, [ic, l]]) => `<label class="chip"><input type="radio" name="kind" value="${k}"${(c.kind || 'struggle') === k ? ' checked' : ''}><span>${ic} ${l}</span></label>`).join('')}</div>
  <div class="fgrid">
    <label><span class="lab">Subject *</span><select name="subject_id" required><option value="">Select…</option>${subjectOpts(c.subject_id)}</select></label>
    <label><span class="lab">Topic (optional)</span><select name="topic_id"><option value="">—</option>${opts(topics.map((t) => [t.id, t.name]), c.topic_id)}</select></label>
    <label class="full"><span class="lab">Note — the idea in your own words (optional)</span><textarea name="note" rows="3">${esc(c.note)}</textarea></label>
    <label class="full"><span class="lab">Where did it come up? (optional)</span><select name="test_id"><option value="">—</option>${opts(tests.map((t) => [t.id, `${t.date} · ${t.name}`]), c.test_id)}</select></label>
  </div>
  <p class="err" data-err></p>
  <div class="row" style="margin-top:8px"><button class="btn primary" type="submit" data-act="save">${editing ? 'Save changes' : 'Save'}</button>${editing ? '' : '<button class="btn" type="submit" data-act="again">Save & add another</button>'}</div>
</form>`;
}

export function bindConceptForm(root, { id = null, onSaved } = {}) {
  const form = $('form.cform', root);
  const sel = (n) => form.elements[n];
  let act = 'save';
  sel('subject_id').addEventListener('change', () => {
    const sid = Number(sel('subject_id').value);
    sel('topic_id').innerHTML = '<option value="">—</option>' + opts(sid ? topicsOf(sid).map((t) => [t.id, t.name]) : [], '');
  });
  form.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) act = b.dataset.act; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', form);
    err.textContent = '';
    const n = (k) => (sel(k).value === '' ? null : Number(sel(k).value));
    const p = {
      title: sel('title').value.trim(), kind: form.querySelector('[name=kind]:checked')?.value || 'struggle',
      subject_id: n('subject_id'), topic_id: n('topic_id'), note: sel('note').value, test_id: n('test_id'),
    };
    if (!p.title) return ((err.textContent = 'Write the concept first.'), sel('title').focus());
    if (!p.subject_id) return ((err.textContent = 'Choose a subject.'), sel('subject_id').focus());
    try {
      const saved = id ? await api('PUT', `/api/mistakes/${id}`, p) : await api('POST', '/api/mistakes', p);
      toast(id ? 'Saved' : `Saved — first review ${saved.next_review}`);
      if (act === 'again' && !id) { sel('title').value = ''; sel('note').value = ''; sel('title').focus(); }
      await onSaved?.(saved, act);
    } catch (ex) { err.textContent = ex.message; }
  });
}

export function openConceptForm({ concept, prefill, onSaved } = {}) {
  const c = concept || prefill || {};
  const modal = openModal(concept ? 'Edit concept' : 'Add a concept', conceptFormHtml(c, { editing: !!concept }));
  bindConceptForm(modal.body, { id: concept?.id, onSaved: async (s, act) => { await onSaved?.(s, act); if (act !== 'again') modal.close(); } });
  setTimeout(() => modal.body.querySelector('[name=title]')?.focus(), 30);
  return modal;
}

/* ------------------------------ page ------------------------------ */
let F = { kind: '', subject: '', q: '', mastered: false };
let currentId = null;
let revealed = false;
let reviewing = false;
export const startReview = () => ((reviewing = true), (revealed = false), (currentId = null));

export function renderConcepts(host, refresh) {
  const root = mount(host);
  const due = dueConcepts();
  const filtered = () => {
    const q = F.q.trim().toLowerCase();
    return D.live.filter((m) => (F.mastered || m.status !== 'mastered') && (!F.kind || m.kind === F.kind) && (!F.subject || m.subject_id === Number(F.subject))
      && (!q || [m.title, m.note, subName(m.subject_id), topName(m.topic_id)].join(' ').toLowerCase().includes(q))).sort((a, b) => b.id - a.id);
  };

  if (reviewing) {
    if (currentId && !D.live.some((m) => m.id === currentId)) currentId = null;
    currentId ||= due[0]?.id ?? null;
    if (!currentId) reviewing = false;
  }
  const cur = reviewing ? D.live.find((m) => m.id === currentId) : null;

  const reviewCard = () => {
    const prev = previewOutcomes(cur, D.today, D.settings.srs);
    const btn = (o, label, cls) => `<button class="btn ${cls}" data-outcome="${o}">${label}<small>→ ${esc(prev[o].next_review)} (${diffDays(prev[o].next_review, D.today)}d)${prev[o].status === 'mastered' ? ' · mastered' : ''}</small></button>`;
    return `<section class="card qcard"><div class="row between"><span>${kindBadge(cur.kind)} ${dueLabel(cur)}</span><span class="muted small">${due.length} left today</span></div>
      <h2 style="margin:12px 0 2px">${esc(cur.title)}</h2>
      <div class="muted small">${esc(subName(cur.subject_id))}${cur.topic_id ? ' › ' + esc(topName(cur.topic_id)) : ''}</div>
      <p class="muted small">Try to explain it from memory, then reveal your note.</p>
      ${revealed ? `<div class="card flat" style="background:var(--panel2)">${cur.note ? `<span class="pre">${esc(cur.note)}</span>` : '<span class="muted">No note saved for this concept.</span>'}</div>
        <div class="outcomes" style="grid-template-columns:repeat(3,1fr)">${btn('independent', 'Got it', 'ok')}${btn('partial', 'Unsure', '')}${btn('forgot', 'Forgot', 'no')}</div>` : '<button class="btn primary" id="reveal">Reveal note</button>'}
      <p style="margin:12px 0 0"><button class="btn ghost small" id="stopReview">Done reviewing</button></p></section>`;
  };

  root.innerHTML = `
<div class="page-head"><div><h1>Concepts</h1><p>${D.live.length} saved · ${due.length} due for review</p></div><button class="btn primary" id="addBtn">＋ Add concept</button></div>
${cur ? reviewCard() : due.length ? `<section class="card row between"><div><b>${due.length} concept${due.length > 1 ? 's' : ''} due for review</b><div class="muted small">A few minutes keeps them from slipping.</div></div><button class="btn primary" id="startReview">Start review</button></section>` : ''}
<div class="card"><div class="row" style="margin-bottom:8px"><input type="search" id="fq" placeholder="Search concepts…" value="${esc(F.q)}" style="flex:1;min-width:180px" aria-label="Search">
  <select id="fsub" aria-label="Subject"><option value="">All subjects</option>${subjectOpts(F.subject)}</select></div>
  <div class="chips">${[['', 'All'], ...Object.entries(KINDS).map(([k, [ic, l]]) => [k, `${ic} ${l}`])].map(([k, l]) => `<label class="chip"><input type="radio" name="fk" value="${k}"${F.kind === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}
  <label class="chip"><input type="checkbox" id="fm"${F.mastered ? ' checked' : ''}><span>Show mastered</span></label></div></div>
<div id="clist"></div>`;

  const drawList = () => {
    const list = filtered();
    $('#clist', root).innerHTML = !D.live.length ? empty('Nothing here yet. Add a concept you found hard, or one you must remember.')
      : !list.length ? empty('No concepts match.')
        : list.slice(0, 200).map((m) => `<div class="card concept" data-id="${m.id}" style="cursor:pointer;margin-bottom:8px"><div class="row between"><b>${esc(m.title)}</b>${dueLabel(m)}</div>
          <div class="muted small">${esc(subName(m.subject_id))}${m.topic_id ? ' › ' + esc(topName(m.topic_id)) : ''}${m.test_name ? ' · ' + esc(m.test_name) : ''}</div>
          <div style="margin-top:6px">${kindBadge(m.kind)} ${statusBadge(m)}</div>${m.note ? `<div class="muted small clipline" style="margin-top:6px">${esc(m.note)}</div>` : ''}</div>`).join('');
  };
  drawList();

  $('#addBtn', root).addEventListener('click', () => openConceptForm({ onSaved: () => refresh() }));
  $('#startReview', root)?.addEventListener('click', () => (startReview(), refresh(false)));
  $('#fq', root).addEventListener('input', debounce((e) => ((F.q = e.target.value), drawList()), 150));
  $('#fsub', root).addEventListener('change', (e) => ((F.subject = e.target.value), drawList()));
  $('#fm', root).addEventListener('change', (e) => ((F.mastered = e.target.checked), drawList()));
  $$('[name=fk]', root).forEach((r) => r.addEventListener('change', () => ((F.kind = r.value), drawList())));
  $('#clist', root).addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (c) showConcept(Number(c.dataset.id), refresh);
  });

  let busy = false;
  root.addEventListener('click', async (e) => {
    if (e.target.closest('#reveal')) return ((revealed = true), refresh(false));
    if (e.target.closest('#stopReview')) return ((reviewing = false), refresh(false));
    const o = e.target.closest('[data-outcome]');
    if (!o || !cur || busy) return;
    busy = true;
    try {
      const res = await api('POST', `/api/mistakes/${cur.id}/reviews`, { outcome: o.dataset.outcome, date: D.today });
      const left = due.filter((m) => m.id !== cur.id);
      currentId = left[0]?.id ?? null;
      revealed = false;
      toast(res.status === 'mastered' ? '🏆 Mastered — now only occasional spot-checks' : `Next review ${res.next_review}`);
      if (!currentId) { reviewing = false; toast('All reviews done 🎉'); }
      await refresh();
    } catch (ex) { fail(ex); } finally { busy = false; }
  });
  const onKey = (e) => {
    if (!cur || e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === ' ' && !revealed) (e.preventDefault(), (revealed = true), refresh(false));
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

function showConcept(id, refresh) {
  const m = D.mistakes.find((x) => x.id === id);
  if (!m) return;
  const hist = (D.reviewsBy.get(m.id) || []).slice().reverse();
  const modal = openModal(m.title, `
<div class="row between"><span>${kindBadge(m.kind)} ${statusBadge(m)} ${dueLabel(m)}</span><div class="row"><button class="btn small" data-a="edit">Edit</button><button class="btn small danger" data-a="del">Delete</button></div></div>
<p class="muted" style="margin:10px 0 0">${esc(subName(m.subject_id))}${m.topic_id ? ' › ' + esc(topName(m.topic_id)) : ''}${m.test_name ? ' · ' + esc(m.test_name) : ''} · added ${esc(m.date_encountered)}</p>
${m.note ? `<p class="pre" style="margin-top:12px">${esc(m.note)}</p>` : '<p class="muted small">No note.</p>'}
<p class="muted small">${m.review_count} review(s) · streak ${m.streak} · ${hist.length ? 'last: ' + esc(hist[0].date) : 'not reviewed yet'}</p>`);
  modal.dlg.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    try {
      if (a === 'edit') { modal.close(); openConceptForm({ concept: m, onSaved: () => refresh() }); }
      else if (a === 'del' && (await confirmDialog(`Delete “${m.title}” and its review history?`))) {
        await api('DELETE', `/api/mistakes/${id}`);
        modal.close();
        toast('Deleted');
        await refresh();
      }
    } catch (ex) { fail(ex); }
  });
}
