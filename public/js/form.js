// The mistake form. One component powers Quick Add (modal, details collapsed),
// the Add Mistake page (details open) and Edit.
import { D, esc, $, $$, api, opts, subjectOpts, topicsOf, subtopicsOf, toast, fail, openModal, shrinkImage, attUrl } from './util.js';
import { todayStr } from '/shared/dates.js';

const TYPES = [['topic', 'Topic test'], ['subject', 'Subject test'], ['mock', 'Full mock'], ['pyq', 'PYQ'], ['practice', 'Practice']];

export function mistakeFormHtml(m = {}, { detailed = false, editing = false } = {}) {
  const tags = (m.tags || []).join(', ');
  const sec = new Set(m.causes_secondary || []);
  const topics = m.subject_id ? topicsOf(m.subject_id) : [];
  const subs = m.topic_id ? subtopicsOf(m.topic_id) : [];
  const providers = [...new Set(D.tests.map((t) => t.provider).concat(D.mistakes.map((x) => x.provider)).filter(Boolean))];
  return `
<form class="mform" autocomplete="off" novalidate>
  <div class="fgrid">
    <label><span class="lab">Date encountered</span><input type="date" name="date_encountered" value="${esc(m.date_encountered || todayStr())}"></label>
    <label><span class="lab">Subject *</span><select name="subject_id" required><option value="">Select…</option>${subjectOpts(m.subject_id)}</select></label>
    <label><span class="lab">Topic</span><select name="topic_id"><option value="">—</option>${opts(topics.map((t) => [t.id, t.name]), m.topic_id)}</select></label>
    <label><span class="lab">Subtopic</span><select name="subtopic_id"><option value="">—</option>${opts(subs.map((t) => [t.id, t.name]), m.subtopic_id)}</select></label>
  </div>
  <fieldset style="margin-top:10px"><legend>Primary cause * (one click)</legend>
    <div class="chips" role="radiogroup">${D.causes.map((c) => `<label class="chip" title="${esc(c.description || '')}"><input type="radio" name="cause_primary" value="${c.id}"${m.cause_primary === c.id ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
  </fieldset>
  <div class="fgrid" style="margin-top:10px">
    <label><span class="lab">Test / mock (optional link)</span><select name="test_id"><option value="">— none —</option>${opts([...D.tests].reverse().map((t) => [t.id, `${t.date} · ${t.name}`]), m.test_id)}</select></label>
    <label><span class="lab">Question no.</span><input name="question_no" value="${esc(m.question_no)}" maxlength="50"></label>
    <label class="full"><span class="lab">Question (text, or a short description)</span><textarea name="question_text" rows="2">${esc(m.question_text)}</textarea></label>
  </div>
  <details class="more"${detailed ? ' open' : ''}><summary>More details (all optional — fill in later)</summary>
    <div class="fgrid" style="margin-top:8px">
      <label><span class="lab">Test type</span><select name="test_type"><option value="">—</option>${opts(TYPES, m.test_type)}</select></label>
      <label><span class="lab">Provider / series</span><input name="provider" list="providers" value="${esc(m.provider)}"><datalist id="providers">${providers.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label><span class="lab">Test name</span><input name="test_name" value="${esc(m.test_name)}"></label>
      <label><span class="lab">Test number</span><input name="test_no" value="${esc(m.test_no)}" maxlength="50"></label>
      <label class="full"><span class="lab">Question reference or URL</span><input name="reference" value="${esc(m.reference)}"></label>
      <label class="full"><span class="lab">Screenshot (choose a file or paste an image with Ctrl+V)</span>
        <input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp">
        <input type="hidden" name="attachment" value="${esc(m.attachment)}"><div class="att-preview">${m.attachment ? `<img class="att" src="${attUrl(m.attachment)}" alt="attachment"> <button type="button" class="btn small" data-rm-att>Remove</button>` : ''}</div></label>
      <label class="full"><span class="lab">My original answer / approach</span><textarea name="my_answer" rows="2">${esc(m.my_answer)}</textarea></label>
      <label><span class="lab">Correct answer</span><input name="correct_answer" value="${esc(m.correct_answer)}"></label>
      <label class="full"><span class="lab">Correct solution / explanation</span><textarea name="solution" rows="4">${esc(m.solution)}</textarea></label>
      <fieldset class="full"><legend>Other contributing causes</legend><div class="chips">${D.causes.map((c) => `<label class="chip sec"><input type="checkbox" name="sec" value="${c.id}"${sec.has(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div></fieldset>
      <label><span class="lab">Difficulty</span><select name="difficulty"><option value="">—</option>${opts([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], m.difficulty)}</select></label>
      <label><span class="lab">Confidence before answering (1–5)</span><select name="confidence"><option value="">—</option>${opts([1, 2, 3, 4, 5].map((n) => [n, n]), m.confidence)}</select></label>
      <label><span class="lab">Time spent (minutes)</span><input type="number" name="time_min" min="0" step="0.5" value="${m.time_spent_sec != null ? Math.round((m.time_spent_sec / 60) * 100) / 100 : ''}"></label>
      <label><span class="lab">Marks lost (incl. negative)</span><input type="number" name="marks_lost" min="0" step="0.33" value="${m.marks_lost ?? ''}"></label>
      <label><span class="lab">Severity (1–5)</span><select name="severity"><option value="">—</option>${opts([1, 2, 3, 4, 5].map((n) => [n, n]), m.severity)}</select></label>
      <label><span class="lab">Tags (comma separated)</span><input name="tags" value="${esc(tags)}"></label>
      <label class="row" style="align-self:end"><input type="checkbox" name="guessed"${m.guessed ? ' checked' : ''}> <span>Guessed</span></label>
      <label class="row" style="align-self:end"><input type="checkbox" name="skipped_solvable"${m.skipped_solvable ? ' checked' : ''}> <span>Skipped though solvable</span></label>
      <label class="full"><span class="lab">Personal lesson / rule learned</span><textarea name="lesson" rows="2">${esc(m.lesson)}</textarea></label>
      ${editing ? `<label><span class="lab">Next review date (manual override; cleared by the next review)</span><input type="date" name="next_review_override" value="${esc(m.next_review_override || '')}"></label>` : ''}
    </div>
  </details>
  <p class="err" data-err></p>
  <div class="row" style="margin-top:8px">
    <button class="btn primary" type="submit" data-act="save">${editing ? 'Save changes' : 'Save'}</button>
    ${editing ? '' : '<button class="btn" type="submit" data-act="again">Save & add another <kbd>Ctrl+Enter</kbd></button>'}
    <span class="hint">* required. Everything else can wait.</span>
  </div>
</form>`;
}

export function bindMistakeForm(root, { editing = false, id = null, onSaved, sticky = true } = {}) {
  const form = $('form.mform', root);
  const sel = (n) => form.elements[n];
  let act = 'save';

  const fillTopics = () => {
    const sid = Number(sel('subject_id').value);
    sel('topic_id').innerHTML = '<option value="">—</option>' + opts(sid ? topicsOf(sid).map((t) => [t.id, t.name]) : [], '');
    fillSubs();
  };
  const fillSubs = () => {
    const tid = Number(sel('topic_id').value);
    sel('subtopic_id').innerHTML = '<option value="">—</option>' + opts(tid ? subtopicsOf(tid).map((t) => [t.id, t.name]) : [], '');
  };
  sel('subject_id').addEventListener('change', fillTopics);
  sel('topic_id').addEventListener('change', fillSubs);
  sel('test_id').addEventListener('change', () => {
    const t = D.testMap.get(Number(sel('test_id').value));
    if (!t) return;
    sel('provider').value = t.provider || '';
    sel('test_name').value = t.name;
    sel('test_type').value = t.type || '';
  });

  const setAttachment = async (file) => {
    try {
      const { file: name } = await api('POST', '/api/attachments', { data: await shrinkImage(file) });
      sel('attachment').value = name;
      $('.att-preview', form).innerHTML = `<img class="att" src="${attUrl(name)}" alt="attachment"> <button type="button" class="btn small" data-rm-att>Remove</button>`;
      toast('Image attached');
    } catch (e) {
      fail(e);
    }
  };
  sel('file').addEventListener('change', () => sel('file').files[0] && setAttachment(sel('file').files[0]));
  form.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) (e.preventDefault(), setAttachment(f));
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-rm-att]')) ((sel('attachment').value = ''), ($('.att-preview', form).innerHTML = ''));
    const b = e.target.closest('button[data-act]');
    if (b) act = b.dataset.act;
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      act = editing ? 'save' : 'again';
      form.requestSubmit();
    }
  });

  const payload = () => {
    const v = (n) => sel(n).value.trim();
    const intOrNull = (n) => (v(n) === '' ? null : Number(v(n)));
    const p = {
      date_encountered: v('date_encountered') || todayStr(),
      subject_id: intOrNull('subject_id'),
      topic_id: intOrNull('topic_id'),
      subtopic_id: intOrNull('subtopic_id'),
      cause_primary: form.querySelector('[name=cause_primary]:checked') ? Number(form.querySelector('[name=cause_primary]:checked').value) : null,
      test_id: intOrNull('test_id'),
      question_no: v('question_no'),
      question_text: sel('question_text').value,
      test_type: v('test_type'), provider: v('provider'), test_name: v('test_name'), test_no: v('test_no'),
      reference: v('reference'), attachment: v('attachment'),
      my_answer: sel('my_answer').value, correct_answer: v('correct_answer'), solution: sel('solution').value,
      causes_secondary: $$('[name=sec]:checked', form).map((c) => Number(c.value)),
      difficulty: v('difficulty'), confidence: intOrNull('confidence'),
      time_spent_sec: v('time_min') === '' ? null : Math.round(Number(v('time_min')) * 60),
      marks_lost: intOrNull('marks_lost'), severity: intOrNull('severity'),
      tags: v('tags').split(',').map((t) => t.trim()).filter(Boolean),
      guessed: sel('guessed').checked, skipped_solvable: sel('skipped_solvable').checked,
      lesson: sel('lesson').value,
    };
    if (editing && sel('next_review_override')) p.next_review_override = v('next_review_override') || null;
    return p;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', form);
    err.textContent = '';
    const p = payload();
    if (!p.subject_id) return ((err.textContent = 'Choose a subject.'), sel('subject_id').focus());
    if (!p.cause_primary) return (err.textContent = 'Choose the primary cause — it decides what corrective action you get.');
    try {
      const saved = editing ? await api('PUT', `/api/mistakes/${id}`, p) : await api('POST', '/api/mistakes', p);
      toast(editing ? 'Saved' : `Saved #${saved.id} — first review ${saved.next_review}`);
      if (act === 'again' && !editing) {
        // keep context fields (subject/topic/test/provider) for rapid entry, clear question-specific ones
        for (const n of ['question_no', 'question_text', 'reference', 'my_answer', 'correct_answer', 'solution', 'lesson', 'tags', 'time_min', 'marks_lost', 'attachment']) sel(n).value = '';
        $('.att-preview', form).innerHTML = '';
        $$('[name=cause_primary],[name=sec]', form).forEach((c) => (c.checked = false));
        sel('guessed').checked = sel('skipped_solvable').checked = false;
        sel('question_no').focus();
      }
      await onSaved?.(saved, act);
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  return form;
}

export function openMistakeForm({ mistake, prefill, detailed, onSaved } = {}) {
  const editing = !!mistake;
  const m = mistake || prefill || {};
  const modal = openModal(editing ? `Edit mistake #${mistake.id}` : 'Quick add mistake', mistakeFormHtml(m, { detailed: detailed ?? editing, editing }), { wide: true });
  bindMistakeForm(modal.body, {
    editing, id: mistake?.id,
    onSaved: async (saved, act) => {
      await onSaved?.(saved, act);
      if (act !== 'again') modal.close();
    },
  });
  setTimeout(() => modal.body.querySelector(editing ? '[name=question_text]' : '[name=subject_id]')?.focus(), 30);
  return modal;
}
