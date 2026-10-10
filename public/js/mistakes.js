import { mount, askText, D, esc, $, $$, api, opts, subjectOpts, subName, topName, causeName, toast, fail, openModal, confirmDialog, pct, mins, attUrl, STATUS_BADGE, empty, debounce, topicsOf } from './util.js';
import { displayStatus, STATUS_LABELS, OUTCOMES } from '/shared/srs.js';
import { repeatCount } from '/shared/analytics.js';
import { diffDays, addDays, todayStr } from '/shared/dates.js';
import { openMistakeForm } from './form.js';

export const emptyFilter = () => ({
  q: '', subject: '', topic: '', cause: '', difficulty: '', status: '', review: '', from: '', to: '', provider: '', test: '',
  repeated: false, reopened: false, minFails: '', minMarks: '', minPriority: '', archived: false, guessed: false, slow: false, skipped: false,
});

const calcCause = () => D.causes.find((c) => /calculation/i.test(c.name));
export function builtinFilters() {
  const mock = [...D.tests].filter((t) => t.type === 'mock').sort((a, b) => b.date.localeCompare(a.date))[0] || [...D.tests].sort((a, b) => b.date.localeCompare(a.date))[0];
  return [
    { name: 'All unresolved', f: { status: 'unresolved' } },
    { name: 'Recurring calculation errors', f: { cause: calcCause()?.id ?? '', repeated: true }, ok: !!calcCause() },
    { name: 'Hard questions', f: { difficulty: 'hard' } },
    { name: 'Overdue reviews', f: { review: 'overdue' } },
    { name: 'From my latest mock', f: { test: mock?.id ?? '' }, ok: !!mock },
    { name: 'Failed more than once', f: { minFails: 2 } },
    { name: 'Mastered, then wrong again', f: { reopened: true } },
  ].filter((x) => x.ok !== false);
}

export function applyFilter(list, f, today = D.today) {
  const q = f.q.trim().toLowerCase();
  const slowSec = D.settings.general.slowSeconds;
  return list.filter((m) => {
    if (!f.archived && m.archived) return false;
    if (f.subject && m.subject_id !== Number(f.subject)) return false;
    if (f.topic && m.topic_id !== Number(f.topic) && m.subtopic_id !== Number(f.topic)) return false;
    if (f.cause && m.cause_primary !== Number(f.cause) && !m.causes_secondary.includes(Number(f.cause))) return false;
    if (f.difficulty && m.difficulty !== f.difficulty) return false;
    if (f.status === 'unresolved' ? m.status === 'mastered' : f.status && m.status !== f.status) return false;
    if (f.review === 'due' && !(m.status !== 'mastered' && m.next_review <= today)) return false;
    if (f.review === 'overdue' && !(m.status !== 'mastered' && m.next_review < today)) return false;
    if (f.review === 'upcoming' && !(m.status !== 'mastered' && m.next_review > today)) return false;
    if (f.from && m.date_encountered < f.from) return false;
    if (f.to && m.date_encountered > f.to) return false;
    if (f.provider && (m.provider || '').toLowerCase() !== f.provider.toLowerCase()) return false;
    if (f.test && m.test_id !== Number(f.test)) return false;
    if (f.repeated && repeatCount(m) < 1) return false;
    if (f.reopened && !m.reopen_count) return false;
    if (f.minFails !== '' && m.fail_count < Number(f.minFails)) return false;
    if (f.minMarks !== '' && (m.marks_lost || 0) < Number(f.minMarks)) return false;
    if (f.minPriority !== '' && (D.prio.get(m.id)?.score || 0) < Number(f.minPriority)) return false;
    if (f.guessed && !m.guessed) return false;
    if (f.skipped && !m.skipped_solvable) return false;
    if (f.slow && !(m.time_spent_sec != null && m.time_spent_sec > slowSec)) return false;
    if (q) {
      const hay = [m.question_text, m.solution, m.my_answer, m.lesson, m.reference, m.test_name, m.question_no, m.correct_answer, ...(m.tags || []), subName(m.subject_id), topName(m.topic_id), causeName(m.cause_primary)].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

const SORTS = {
  next: ['Next review', (a, b) => a.next_review.localeCompare(b.next_review)],
  priority: ['Priority', (a, b) => (D.prio.get(b.id)?.score || 0) - (D.prio.get(a.id)?.score || 0)],
  repeats: ['Recurrence', (a, b) => repeatCount(b) - repeatCount(a)],
  marks: ['Marks lost', (a, b) => (b.marks_lost || 0) - (a.marks_lost || 0)],
  recent: ['Most recently added', (a, b) => b.id - a.id],
};

export const snippet = (m) => {
  const t = (m.question_text || '').replace(/\s+/g, ' ').trim();
  const ref = [m.test_name, m.question_no && `Q${m.question_no}`].filter(Boolean).join(' · ');
  return t ? t.slice(0, 120) : ref || m.reference || m.lesson || `(no question text)`;
};
export const statusBadge = (m) => {
  const s = displayStatus(m, D.today);
  return `<span class="badge ${STATUS_BADGE[s] || ''}">${esc(STATUS_LABELS[s])}</span>`;
};
export const dueLabel = (m) => {
  if (m.status === 'mastered') return `<span class="muted">maintenance ${esc(m.next_review)}</span>`;
  const d = diffDays(m.next_review, D.today);
  const t = d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d`;
  return `<span class="${d < 0 ? 'badge bad' : d === 0 ? 'badge warn' : ''}" title="${esc(m.next_review)}">${t}</span>`;
};

let F = emptyFilter();
let sort = 'next';
let limit = 100;
const selected = new Set();

export function setFilter(f) {
  F = { ...emptyFilter(), ...f };
  limit = 100;
  selected.clear();
}

export function renderMistakes(host, refresh) {
  const root = mount(host);
  const draw = () => {
    const list = applyFilter(D.mistakes, F).sort(SORTS[sort][1]);
    const shown = list.slice(0, limit);
    const total = D.mistakes.filter((m) => !m.archived).length;
    const providers = [...new Set(D.mistakes.map((m) => m.provider).filter(Boolean))].sort();
    const saved = D.settings.savedFilters || [];
    $('#mlist', root).innerHTML = !total
      ? empty('No mistakes recorded yet. Press <b>N</b> or use “Quick add” to log your first one.')
      : !list.length
        ? empty('No mistakes match these filters.')
        : `<div class="tablewrap"><table><thead><tr><th><input type="checkbox" id="selAll" aria-label="Select all shown"${shown.length && shown.every((m) => selected.has(m.id)) ? ' checked' : ''}></th><th>#</th><th>Date</th><th>Subject / topic</th><th>Question</th><th>Cause</th><th>Status</th><th>Next review</th><th class="num" title="Higher = revise sooner. Hover a score for its reasons.">Priority</th><th class="num" title="Recurrences + failed reviews">Rep.</th><th class="num">Lost</th></tr></thead><tbody>${shown
            .map((m) => {
              const p = D.prio.get(m.id);
              return `<tr class="click" data-id="${m.id}"${m.archived ? ' style="opacity:.55"' : ''}><td><input type="checkbox" data-sel="${m.id}" aria-label="Select #${m.id}"${selected.has(m.id) ? ' checked' : ''}></td><td>${m.id}</td><td class="nowrap">${esc(m.date_encountered)}</td><td>${esc(subName(m.subject_id))}<div class="muted small">${esc(topName(m.topic_id))}</div></td><td class="clip" title="${esc(snippet(m))}">${esc(snippet(m))}${m.attachment ? ' 🖼' : ''}${(m.tags || []).map((t) => ` <span class="badge">${esc(t)}</span>`).join('')}</td><td>${esc(causeName(m.cause_primary))}</td><td>${statusBadge(m)}</td><td class="nowrap">${dueLabel(m)}</td><td class="num" title="${esc(p.parts.map((x) => `${x.label}: ${x.points > 0 ? '+' : ''}${x.points}`).join('\n'))}">${p.score}</td><td class="num">${repeatCount(m) || ''}</td><td class="num">${m.marks_lost ?? ''}</td></tr>`;
            })
            .join('')}</tbody></table></div>${list.length > shown.length ? `<p class="center"><button class="btn" id="more">Show more (${list.length - shown.length} hidden)</button></p>` : ''}`;
    $('#mcount', root).textContent = `${list.length} of ${total} shown`;
    $('#bulk', root).hidden = !selected.size;
    $('#bulkN', root).textContent = `${selected.size} selected`;
    $('#selAll', root)?.addEventListener('change', (e) => {
      shown.forEach((m) => (e.target.checked ? selected.add(m.id) : selected.delete(m.id)));
      draw();
    });
    $('#more', root)?.addEventListener('click', () => ((limit += 200), draw()));
    void providers; void saved;
  };

  const f = F;
  root.innerHTML = `
<div class="page-head"><div><h1>All mistakes</h1><p id="mcount" class="muted"></p></div><button class="btn primary" id="addBtn">＋ Add mistake</button></div>
<div class="card">
  <div class="row" style="margin-bottom:8px">
    <input type="search" id="fq" placeholder="Search question, solution, notes, tags…" value="${esc(f.q)}" style="flex:1;min-width:220px" aria-label="Search">
    <select id="saved" aria-label="Saved filters"><option value="">Saved filters…</option>${opts(builtinFilters().map((x, i) => ['b' + i, x.name]), '')}${(D.settings.savedFilters || []).map((x, i) => `<option value="u${i}">★ ${esc(x.name)}</option>`).join('')}</select>
    <button class="btn" id="saveF" title="Save the current filters">Save filter</button>
    <button class="btn" id="resetF">Reset</button>
  </div>
  <div class="filters">
    <select id="fsub" aria-label="Subject"><option value="">All subjects</option>${subjectOpts(f.subject)}</select>
    <select id="ftop" aria-label="Topic"><option value="">All topics</option>${opts((f.subject ? topicsOf(Number(f.subject)) : []).map((t) => [t.id, t.name]), f.topic)}</select>
    <select id="fcause" aria-label="Root cause"><option value="">Any cause</option>${opts(D.causes.map((c) => [c.id, c.name]), f.cause)}</select>
    <select id="fstatus" aria-label="Mastery status"><option value="">Any status</option><option value="unresolved"${f.status === 'unresolved' ? ' selected' : ''}>Unresolved (not mastered)</option>${opts(Object.entries(STATUS_LABELS).filter(([k]) => k !== 'due_first'), f.status)}</select>
    <select id="freview" aria-label="Review status"><option value="">Any review state</option>${opts([['due', 'Due (today or overdue)'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming']], f.review)}</select>
  </div>
  <details class="more" style="margin-top:10px"><summary>More filters</summary><div class="filters" style="margin-top:10px">
    <select id="fdiff" aria-label="Difficulty"><option value="">Any difficulty</option>${opts([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], f.difficulty)}</select>
    <select id="fprov" aria-label="Provider"><option value="">Any provider</option>${opts([...new Set(D.mistakes.map((m) => m.provider).filter(Boolean))].sort().map((p) => [p, p]), f.provider)}</select>
    <select id="ftest" aria-label="Test"><option value="">Any test</option>${opts([...D.tests].reverse().map((t) => [t.id, `${t.date} · ${t.name}`]), f.test)}</select>
    <label><input type="date" id="ffrom" value="${esc(f.from)}" aria-label="From date" title="From date"></label>
    <label><input type="date" id="fto" value="${esc(f.to)}" aria-label="To date" title="To date"></label>
    <input type="number" id="fmarks" placeholder="Min marks lost" min="0" step="0.33" value="${esc(f.minMarks)}" aria-label="Minimum marks lost">
    <input type="number" id="fprio" placeholder="Min priority" min="0" value="${esc(f.minPriority)}" aria-label="Minimum priority">
  </div>
  <div class="row" style="margin-top:12px">
    ${[['repeated', 'Repeated'], ['reopened', 'Reopened after mastery'], ['guessed', 'Guessed'], ['skipped', 'Skipped though solvable'], ['slow', `Slow (> ${D.settings.general.slowSeconds}s)`], ['archived', 'Include archived']].map(([k, l]) => `<label class="row gap-s"><input type="checkbox" data-flag="${k}"${f[k] ? ' checked' : ''}> <span>${l}</span></label>`).join('')}
  </div></details>
  <div class="row" style="margin-top:12px"><span style="flex:1"></span>
    <label class="row gap-s"><span class="muted">Sort</span><select id="sort">${opts(Object.entries(SORTS).map(([k, v]) => [k, v[0]]), sort)}</select></label>
  </div>
</div>
<div id="mlist"></div>
<div class="sticky-bulk" id="bulk" hidden>
  <div class="row"><b id="bulkN"></b>
    <select id="bulkAct"><option value="">Bulk action…</option><option value="archive">Archive</option><option value="unarchive">Unarchive</option><option value="add_tag">Add tag…</option><option value="set_cause">Set primary cause…</option><option value="set_severity">Set severity…</option><option value="set_next_review">Set next review date…</option><option value="delete">Delete</option></select>
    <span id="bulkVal"></span><button class="btn primary small" id="bulkGo">Apply</button><button class="btn small" id="bulkClear">Clear</button></div>
</div>`;

  const rerender = () => renderMistakes(host, refresh);
  const bind = (id, key, ev = 'change') => $(id, root).addEventListener(ev, (e) => ((F[key] = e.target.value), (limit = 100), key === 'subject' ? ((F.topic = ''), rerender()) : draw()));
  bind('#fsub', 'subject'); bind('#ftop', 'topic'); bind('#fcause', 'cause'); bind('#fdiff', 'difficulty'); bind('#fstatus', 'status');
  bind('#freview', 'review'); bind('#fprov', 'provider'); bind('#ftest', 'test'); bind('#ffrom', 'from'); bind('#fto', 'to');
  bind('#fmarks', 'minMarks', 'input'); bind('#fprio', 'minPriority', 'input');
  $('#fq', root).addEventListener('input', debounce((e) => ((F.q = e.target.value), (limit = 100), draw()), 150));
  $$('[data-flag]', root).forEach((c) => c.addEventListener('change', () => ((F[c.dataset.flag] = c.checked), draw())));
  $('#sort', root).addEventListener('change', (e) => ((sort = e.target.value), draw()));
  $('#resetF', root).addEventListener('click', () => (setFilter({}), rerender()));
  $('#addBtn', root).addEventListener('click', () => openMistakeForm({ detailed: true, onSaved: refresh }));
  $('#saved', root).addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const src = v[0] === 'b' ? builtinFilters()[Number(v.slice(1))].f : D.settings.savedFilters[Number(v.slice(1))].filter;
    setFilter(src);
    rerender();
  });
  $('#saveF', root).addEventListener('click', async () => {
    const name = await askText('Save filter', 'Name for this filter');
    if (!name) return;
    try {
      await api('PUT', '/api/settings/savedFilters', { value: [...(D.settings.savedFilters || []), { name: name.trim(), filter: { ...F } }] });
      toast('Filter saved');
      await refresh();
    } catch (e) { fail(e); }
  });

  root.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-sel]');
    if (cb) {
      cb.checked ? selected.add(Number(cb.dataset.sel)) : selected.delete(Number(cb.dataset.sel));
      $('#bulk', root).hidden = !selected.size;
      $('#bulkN', root).textContent = `${selected.size} selected`;
      return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('input')) showMistake(Number(tr.dataset.id), refresh);
  });

  $('#bulkAct', root).addEventListener('change', (e) => {
    const a = e.target.value;
    $('#bulkVal', root).innerHTML = a === 'add_tag' ? '<input id="bv" placeholder="tag">' : a === 'set_cause' ? `<select id="bv">${opts(D.causes.map((c) => [c.id, c.name]))}</select>` : a === 'set_severity' ? `<select id="bv">${opts([1, 2, 3, 4, 5].map((n) => [n, n]))}</select>` : a === 'set_next_review' ? `<input type="date" id="bv" value="${addDays(todayStr(), 1)}">` : '';
  });
  $('#bulkClear', root).addEventListener('click', () => (selected.clear(), draw()));
  $('#bulkGo', root).addEventListener('click', async () => {
    const action = $('#bulkAct', root).value;
    if (!action) return toast('Choose a bulk action first', true);
    const ids = [...selected];
    let value = $('#bv', root)?.value;
    if (['set_cause', 'set_severity'].includes(action)) value = Number(value);
    if (action === 'delete' && !(await confirmDialog(`Permanently delete ${ids.length} mistake(s) and their review history? This cannot be undone.`))) return;
    try {
      await api('POST', '/api/mistakes/bulk', { ids, action, value });
      selected.clear();
      toast('Bulk action applied');
      await refresh();
    } catch (e2) { fail(e2); }
  });
  draw();
}

export function showMistake(id, refresh) {
  const m = D.mistakes.find((x) => x.id === id);
  if (!m) return;
  const p = D.prio.get(m.id);
  const cause = D.causeMap.get(m.cause_primary);
  const hist = (D.reviewsBy.get(m.id) || []).slice().reverse();
  const kv = (k, v) => (v === null || v === undefined || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`);
  const test = D.testMap.get(m.test_id);
  const body = `
<div class="row between"><div>${statusBadge(m)} ${m.archived ? '<span class="badge">Archived</span>' : ''} <span class="badge">Priority ${p.score}</span></div>
  <div class="row"><button class="btn small" data-a="edit">Edit</button><button class="btn small" data-a="dup">Duplicate</button><button class="btn small" data-a="arch">${m.archived ? 'Unarchive' : 'Archive'}</button><button class="btn small danger" data-a="del">Delete</button></div></div>
<h3 style="margin-top:12px">${esc(subName(m.subject_id))} › ${esc(topName(m.topic_id))}${m.subtopic_id ? ' › ' + esc(topName(m.subtopic_id)) : ''}</h3>
${m.question_text ? `<div class="qtext">${esc(m.question_text)}</div>` : ''}
${m.attachment ? `<p><a href="${attUrl(m.attachment)}" target="_blank" rel="noopener"><img class="att" src="${attUrl(m.attachment)}" alt="attachment"></a></p>` : ''}
<dl class="kv">
  ${kv('Date', esc(m.date_encountered))}${kv('Primary cause', `<b>${esc(causeName(m.cause_primary))}</b>`)}${kv('Also', m.causes_secondary.map((c) => esc(causeName(c))).join(', '))}
  ${kv('Test', test ? esc(`${test.name} (${test.date})`) : esc([m.provider, m.test_name, m.test_no, m.test_type].filter(Boolean).join(' · ')))}${kv('Question no.', esc(m.question_no))}
  ${kv('Reference', m.reference ? (/^https?:\/\//i.test(m.reference) ? `<a href="${esc(m.reference)}" target="_blank" rel="noopener noreferrer">${esc(m.reference)}</a>` : esc(m.reference)) : '')}
  ${kv('My answer / approach', m.my_answer ? `<span class="pre">${esc(m.my_answer)}</span>` : '')}${kv('Correct answer', esc(m.correct_answer))}
  ${kv('Solution', m.solution ? `<span class="pre">${esc(m.solution)}</span>` : '')}${kv('Lesson / rule', m.lesson ? `<b class="pre">${esc(m.lesson)}</b>` : '')}
  ${kv('Difficulty', esc(m.difficulty))}${kv('Confidence', m.confidence ? `${m.confidence}/5` : '')}${kv('Time spent', m.time_spent_sec != null ? mins(m.time_spent_sec) : '')}
  ${kv('Marks lost', m.marks_lost)}${kv('Severity', m.severity ? `${m.severity}/5` : '')}${kv('Tags', m.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join(' '))}
  ${kv('Flags', [m.guessed && 'guessed', m.skipped_solvable && 'skipped though solvable'].filter(Boolean).join(', '))}
  ${kv('Schedule', m.status === 'mastered' ? `Mastered ${esc(m.mastered_at)} · maintenance ${esc(m.next_review)}` : `Next review ${esc(m.next_review)} (${diffDays(m.next_review, D.today) < 0 ? -diffDays(m.next_review, D.today) + 'd overdue' : diffDays(m.next_review, D.today) === 0 ? 'today' : 'in ' + diffDays(m.next_review, D.today) + 'd'})`)}
  ${kv('Record', `${m.review_count} review(s) · ${m.success_count} independent · streak ${m.streak} · ${m.fail_count} failed · ${m.recurrence_count} recurrence(s) · reopened ${m.reopen_count}×`)}
</dl>
${cause?.guidance ? `<div class="info-box"><b>What to do about “${esc(cause.name)}”:</b> ${esc(cause.guidance)}</div>` : ''}
<details class="more"><summary>Why this priority score (${p.score})</summary><table><tbody>${p.parts.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.points > 0 ? '+' : ''}${x.points}</td></tr>`).join('')}</tbody></table><p class="hint">Weights are configurable in Settings. This is a plain sum of the lines above.</p></details>
<h3 style="margin-top:14px">Review history</h3>
${hist.length ? `<table><tbody>${hist.map((r) => `<tr><td class="nowrap">${esc(r.date)}</td><td>${esc(OUTCOMES[r.outcome]?.label || r.outcome)}</td><td class="muted">${esc(r.note || '')}</td><td class="right"><button class="btn small ghost" data-undo="${r.id}" title="Remove this event and re-derive the schedule">Undo</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No reviews yet.</p>'}
<div class="row" style="margin-top:10px"><button class="btn" data-a="again">Got it wrong again (recurrence)</button><span class="hint">Use when the same question/concept is wrong in a later test. Reopens it if mastered.</span></div>`;
  const modal = openModal(`Mistake #${m.id}`, body, { wide: true });
  modal.dlg.addEventListener('click', async (e) => {
    try {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const undo = e.target.closest('[data-undo]')?.dataset.undo;
      if (undo) {
        await api('DELETE', `/api/reviews/${undo}`);
        modal.close();
        await refresh();
        showMistake(id, refresh);
      } else if (a === 'edit') {
        modal.close();
        openMistakeForm({ mistake: m, onSaved: refresh });
      } else if (a === 'dup') {
        const c = await api('POST', `/api/mistakes/${id}/duplicate`, { date: todayStr() });
        toast(`Duplicated as #${c.id}`);
        modal.close();
        await refresh();
      } else if (a === 'arch') {
        await api('PUT', `/api/mistakes/${id}`, { archived: !m.archived });
        modal.close();
        toast(m.archived ? 'Unarchived' : 'Archived (excluded from analytics and reviews)');
        await refresh();
      } else if (a === 'del') {
        if (await confirmDialog(`Permanently delete mistake #${id} and its review history? This cannot be undone.\n\nTip: Archive hides it without losing data.`)) {
          await api('DELETE', `/api/mistakes/${id}`);
          modal.close();
          toast('Deleted');
          await refresh();
        }
      } else if (a === 'again') {
        await api('POST', `/api/mistakes/${id}/reviews`, { outcome: 'recurred', date: todayStr() });
        toast('Recurrence recorded — back in the review queue tomorrow');
        modal.close();
        await refresh();
        showMistake(id, refresh);
      }
    } catch (ex) { fail(ex); }
  });
}
