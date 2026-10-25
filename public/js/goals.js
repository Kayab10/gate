// Weekly goals: things to get done "some time this week" that are not tied to a particular day.
import { D, esc, api, subjectOpts, subName, toast, fail, askText } from './util.js';
import { addDays, weekStart, shortDate } from '/shared/dates.js';

const hue = (g) => (g.subject_id ? (g.subject_id * 47) % 360 : 250);
const forWeek = (ws) => (D.goals || []).filter((g) => g.week_start === ws).sort((a, b) => a.done - b.done || a.id - b.id);

/** HTML for the goals of the week starting `ws` (a Monday). compact = dashboard chips; otherwise a list with a subject picker. */
export function goalsCard(ws, { compact = false, cls = '' } = {}) {
  const list = forWeek(ws);
  const doneN = list.filter((g) => g.done).length;
  const isNow = ws === weekStart(D.today);
  const last = isNow ? forWeek(addDays(ws, -7)).filter((g) => !g.done) : [];
  const item = (g) => `<div class="goal${g.done ? ' done' : ''}" style="--h:${hue(g)}"><input type="checkbox" data-gchk="${g.id}"${g.done ? ' checked' : ''} aria-label="Done: ${esc(g.title)}"><span class="gt" data-gedit="${g.id}" title="Tap to rename">${esc(g.title)}</span>${g.subject_id && !compact ? `<span class="tag">${esc(subName(g.subject_id))}</span>` : ''}<button class="gx" data-gdel="${g.id}" aria-label="Remove goal">✕</button></div>`;
  return `<section class="card goals${compact ? ' compact' : ''} ${cls}" data-goalweek="${esc(ws)}">
  <div class="row between"><h2 style="margin:0">${isNow ? 'This week’s goals' : `Goals · week of ${esc(shortDate(ws))}`}</h2><span class="muted small">${list.length ? `${doneN} of ${list.length} done` : 'not tied to a day'}</span></div>
  ${list.length ? `<div class="prog" style="margin:10px 0 8px"><div style="width:${(doneN / list.length) * 100}%"></div></div>` : ''}
  <div class="glist">${list.map(item).join('') || '<p class="muted small" style="margin:8px 0 0">No goals yet — add what you want to achieve this week, even if it can’t be split by day.</p>'}</div>
  <form class="goaladd" autocomplete="off"><input name="title" maxlength="300" placeholder="e.g. Finish the Probability chapter" aria-label="New goal" required>${compact ? '' : `<select name="subject_id" aria-label="Subject"><option value="">Subject</option>${subjectOpts()}</select>`}<button class="btn primary small">Add goal</button></form>
  ${last.length ? `<button class="btn small" data-carry="${last.map((g) => g.id).join(',')}" style="margin-top:10px">Carry over ${last.length} unfinished from last week</button>` : ''}
</section>`;
}

/** Wire every goals card inside `root`. */
export function bindGoals(root, refresh) {
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.goaladd');
    if (!form) return;
    e.preventDefault();
    const ws = form.closest('[data-goalweek]').dataset.goalweek;
    try {
      await api('POST', '/api/goals', { title: form.elements.title.value, week_start: ws, subject_id: form.elements.subject_id?.value || null });
      await refresh();
    } catch (ex) { fail(ex); }
  });
  root.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-gchk]');
    if (c) try { await api('PUT', `/api/goals/${c.dataset.gchk}`, { done: c.checked }); await refresh(); } catch (ex) { fail(ex); }
  });
  root.addEventListener('click', async (e) => {
    try {
      const del = e.target.closest('[data-gdel]');
      if (del) return (await api('DELETE', `/api/goals/${del.dataset.gdel}`), refresh());
      const ed = e.target.closest('[data-gedit]');
      if (ed) {
        const g = D.goals.find((x) => x.id === Number(ed.dataset.gedit));
        const title = await askText('Rename goal', 'Goal', g.title);
        if (title && title !== g.title) { await api('PUT', `/api/goals/${g.id}`, { title }); await refresh(); }
        return;
      }
      const carry = e.target.closest('[data-carry]');
      if (carry) {
        const ws = weekStart(D.today);
        for (const id of carry.dataset.carry.split(',')) await api('PUT', `/api/goals/${id}`, { week_start: ws });
        toast('Carried over');
        await refresh();
      }
    } catch (ex) { fail(ex); }
  });
}
