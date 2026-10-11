import { mount, D, esc, $, api, subName, topName, causeName, toast, fail, empty, attUrl } from './util.js';
import { previewOutcomes, OUTCOMES, REVIEW_OUTCOMES } from '/shared/srs.js';
import { diffDays } from '/shared/dates.js';
import { statusBadge, dueLabel, snippet, showMistake } from './mistakes.js';

let currentId = null;
let revealed = false;
let reviewDate = null;

export const queueLists = () => {
  const live = D.live;
  const byPrio = (a, b) => (a.next_review < D.today ? 0 : 1) - (b.next_review < D.today ? 0 : 1) || D.prio.get(b.id).score - D.prio.get(a.id).score;
  return {
    due: live.filter((m) => m.status !== 'mastered' && m.next_review <= D.today).sort(byPrio),
    upcoming: live.filter((m) => m.status !== 'mastered' && m.next_review > D.today && diffDays(m.next_review, D.today) <= 14).sort((a, b) => a.next_review.localeCompare(b.next_review)),
    maintenance: live.filter((m) => m.status === 'mastered' && m.next_review <= D.today).sort((a, b) => a.next_review.localeCompare(b.next_review)),
  };
};

export function renderReview(host, refresh) {
  const root = mount(host);
  const { due, upcoming, maintenance } = queueLists();
  reviewDate ||= D.today;
  if (currentId && !D.live.some((m) => m.id === currentId)) currentId = null;
  if (!currentId) currentId = (due[0] || maintenance[0])?.id ?? null;
  const overdue = due.filter((m) => m.next_review < D.today).length;
  const cur = D.live.find((m) => m.id === currentId);
  const srs = D.settings.srs;
  let started = Date.now();

  const cardHtml = () => {
    if (!cur) return empty(D.live.length ? '🎉 Nothing due. Check the upcoming list, or open “Today’s plan” on the dashboard.' : 'No mistakes recorded yet.');
    const prev = previewOutcomes(cur, reviewDate, srs);
    const p = D.prio.get(cur.id);
    const hasAnswer = cur.solution || cur.correct_answer || cur.my_answer || cur.lesson;
    return `<div class="qcard">
      <div class="row between"><div>${statusBadge(cur)} ${dueLabel(cur)} <span class="badge">streak ${cur.streak}/${srs.masteryStreak}</span> ${cur.difficulty ? `<span class="badge">${esc(cur.difficulty)}</span>` : ''}</div><div class="muted small">⏱ <span id="timer">0:00</span></div></div>
      <h3 style="margin-top:8px">${esc(subName(cur.subject_id))} › ${esc(topName(cur.topic_id))}</h3>
      <div class="muted small">${esc([cur.provider, cur.test_name, cur.question_no && 'Q' + cur.question_no, cur.reference].filter(Boolean).join(' · '))}</div>
      ${cur.question_text ? `<div class="qtext">${esc(cur.question_text)}</div>` : `<div class="qtext muted">${esc(snippet(cur))}<br><span class="small">(No question text stored — open the reference/screenshot, or solve it from your source.)</span></div>`}
      ${cur.attachment ? `<p><img class="att" src="${attUrl(cur.attachment)}" alt="question screenshot"></p>` : ''}
      ${/^https?:\/\//i.test(cur.reference || '') ? `<p><a href="${esc(cur.reference)}" target="_blank" rel="noopener noreferrer">Open question reference ↗</a></p>` : ''}
      <p class="muted small">Solve it again <b>without looking</b>, then reveal the solution to check yourself, then record the honest outcome.</p>
      ${revealed ? `<div class="card flat" style="background:var(--panel2)">
          ${cur.my_answer ? `<div><b>My earlier answer:</b> <span class="pre">${esc(cur.my_answer)}</span></div>` : ''}
          ${cur.correct_answer ? `<div><b>Correct answer:</b> ${esc(cur.correct_answer)}</div>` : ''}
          ${cur.solution ? `<div><b>Solution:</b> <span class="pre">${esc(cur.solution)}</span></div>` : ''}
          ${cur.lesson ? `<div><b>Rule I wrote:</b> <span class="pre">${esc(cur.lesson)}</span></div>` : ''}
          ${hasAnswer ? '' : '<span class="muted">No solution was stored for this entry.</span>'}
          <div class="info-box" style="margin-bottom:0"><b>${esc(causeName(cur.cause_primary))}:</b> ${esc(D.causeMap.get(cur.cause_primary)?.guidance || '')}</div>
        </div>` : '<button class="btn" id="reveal">Reveal solution <kbd>Space</kbd></button>'}
      <div class="row" style="margin:10px 0 0"><label class="row gap-s"><span class="muted small">Review date</span><input type="date" id="rdate" value="${esc(reviewDate)}" max="${esc(D.today)}"></label><input id="rnote" placeholder="Optional note about this attempt" style="flex:1;min-width:180px"></div>
      <div class="outcomes">${REVIEW_OUTCOMES.map((o, i) => `<button class="btn ${o === 'independent' ? 'ok' : o === 'failed' || o === 'forgot' ? 'no' : ''}" data-outcome="${o}">${i + 1}. ${esc(OUTCOMES[o].label)}<small>→ ${esc(prev[o].next_review)} (${diffDays(prev[o].next_review, reviewDate)}d)${prev[o].status === 'mastered' ? ' · mastered' : ''}</small></button>`).join('')}</div>
      <p class="hint">Mastery needs ${srs.masteryStreak} consecutive <b>independent</b> solves on different days. Hints, partial solves and failures reset the streak. Priority ${p.score}: ${esc(p.reason)}</p>
    </div>`;
  };

  root.innerHTML = `
<div class="page-head"><div><h1>Review queue</h1><p>${due.length} due now (${overdue} overdue) · ${upcoming.length} in the next 14 days</p></div></div>
<div class="card" id="card">${cardHtml()}</div>
<div class="grid g2">
  <div><h2>Due now</h2>${list(due, 'Nothing due.')}</div>
  <div><h2>Upcoming (14 days)</h2>${list(upcoming, 'No reviews scheduled in the next 14 days.', true)}
  ${maintenance.length ? `<h2 style="margin-top:14px">Maintenance (mastered)</h2>${list(maintenance, '')}` : ''}</div>
</div>`;

  function list(items, emptyMsg, showDate) {
    if (!items.length) return empty(emptyMsg);
    return `<div class="tablewrap"><table><tbody>${items.slice(0, 60).map((m) => `<tr class="click" data-pick="${m.id}"${m.id === currentId ? ' style="background:var(--accent-soft)"' : ''}><td class="nowrap">${showDate ? esc(m.next_review) : dueLabel(m)}</td><td>${esc(subName(m.subject_id))}<div class="muted small">${esc(topName(m.topic_id))}</div></td><td class="clip">${esc(snippet(m))}</td><td class="num" title="${esc(D.prio.get(m.id).reason)}">${D.prio.get(m.id).score}</td></tr>`).join('')}</tbody></table></div>${items.length > 60 ? `<p class="muted small">…and ${items.length - 60} more</p>` : ''}`;
  }

  const redrawCard = () => {
    $('#card', root).innerHTML = cardHtml();
    started = Date.now();
  };
  let busy = false;
  const record = async (outcome) => {
    if (!cur || busy) return; // a double-click must not record the same review twice
    busy = true;
    try {
      const note = $('#rnote', root)?.value.trim();
      const res = await api('POST', `/api/mistakes/${cur.id}/reviews`, { outcome, date: reviewDate, note, time_spent_sec: Math.round((Date.now() - started) / 1000) });
      const next = [...due, ...maintenance].filter((m) => m.id !== cur.id);
      const idx = [...due, ...maintenance].findIndex((m) => m.id === cur.id);
      currentId = (next[idx] || next[0])?.id ?? null;
      revealed = false;
      toast(res.status === 'mastered' ? '🏆 Mastered — it moves to maintenance reviews' : `${OUTCOMES[outcome].label} → next review ${res.next_review}`);
      await refresh();
    } catch (e) { fail(e); } finally { busy = false; }
  };

  root.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      currentId = Number(pick.dataset.pick);
      revealed = false;
      return refresh(false);
    }
    if (e.target.closest('#reveal')) ((revealed = true), redrawCardKeepTimer());
    const o = e.target.closest('[data-outcome]');
    if (o) record(o.dataset.outcome);
  });
  root.addEventListener('contextmenu', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) (e.preventDefault(), showMistake(Number(pick.dataset.pick), refresh));
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'rdate' && e.target.value) {
      reviewDate = e.target.value > D.today ? D.today : e.target.value;
      redrawCardKeepTimer();
    }
  });
  function redrawCardKeepTimer() {
    const t = started;
    const note = $('#rnote', root)?.value;
    redrawCard();
    started = t;
    if (note) $('#rnote', root).value = note;
  }

  const onKey = (e) => {
    if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === ' ' && !revealed && cur) (e.preventDefault(), (revealed = true), redrawCardKeepTimer());
    else if (/^[1-5]$/.test(e.key) && cur) record(REVIEW_OUTCOMES[Number(e.key) - 1]);
  };
  document.addEventListener('keydown', onKey);
  const timer = setInterval(() => {
    const el = $('#timer', root);
    if (el) {
      const s = Math.floor((Date.now() - started) / 1000);
      el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }, 1000);
  return () => (document.removeEventListener('keydown', onKey), clearInterval(timer));
}

export const resetReviewDate = () => (reviewDate = null);
export const focusReview = (id) => ((currentId = id), (revealed = false));

