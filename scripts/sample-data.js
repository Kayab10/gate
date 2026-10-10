// Demo data for trying out the UI (Mechanical Engineering stream). Everything it creates is tagged so it can be removed again:
//   node scripts/sample-data.js           add sample data (app must be running locally: node dev-server.js)
//   node scripts/sample-data.js --remove  delete only the sample data
// Uses the running app's HTTP API. Set PORT if the app is not on 5050.
const BASE = `http://localhost:${process.env.PORT || 5050}`;
const TAG = 'sample';
let stream = '';
const api = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(stream ? { 'X-Stream': String(stream) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`);
  return j;
};
const pad = (n) => String(n).padStart(2, '0');
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const add = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function remove() {
  const b = await api('GET', '/api/bootstrap');
  const ms = b.mistakes.filter((m) => m.tags.includes(TAG));
  if (ms.length) await api('POST', '/api/mistakes/bulk', { ids: ms.map((m) => m.id), action: 'delete' });
  for (const t of b.tests.filter((t) => t.name.startsWith('[Sample]'))) await api('DELETE', `/api/tests/${t.id}`);
  for (const t of b.tasks.filter((t) => t.title.startsWith('[Sample]'))) await api('DELETE', `/api/tasks/${t.id}`);
  for (const l of b.studyLog.filter((l) => l.note === TAG)) await api('DELETE', `/api/log/${l.id}`);
  for (const p of b.progress.filter((p) => p.notes === TAG)) await api('PUT', `/api/progress/${p.topic_id}`, { studied: false, revision_count: 0, pyq_done: false, notes: '' });
  console.log(`Removed ${ms.length} sample mistakes and the sample tests, tasks, study log and checklist entries.`);
}

async function main() {
  const streams = await api('GET', '/api/streams');
  stream = (streams.find((s) => s.code === 'ME') || streams[0]).id;
  if (process.argv.includes('--remove')) return remove();
  const b = await api('GET', '/api/bootstrap');
  if (b.mistakes.some((m) => m.tags.includes(TAG))) return console.log('Sample data is already loaded. Run with --remove first to reload it.');
  const S = (name) => b.subjects.find((s) => s.name === name);
  const T = (subj, i) => b.topics.filter((t) => t.subject_id === subj.id && !t.parent_id)[i];
  const C = (word) => b.causes.find((c) => new RegExp(word, 'i').test(c.name)).id;
  const th = S('Thermodynamics'), mm = S('Mechanics of Materials'), fm = S('Fluid Mechanics'), tom = S('Theory of Machines'), md = S('Machine Design'),
    ht = S('Heat Transfer'), em = S('Engineering Mechanics'), mt = S('Engineering Mathematics') || S('Calculus'), mach = S('Machining and Machine Tools'), orr = S('Operations Research');

  const tests = [
    { name: '[Sample] Series A Mock 1', provider: 'Series A', date: add(today, -35), type: 'mock', total_questions: 65, total_marks: 100, marks_obtained: 34.7, correct: 25, incorrect: 24, negative_marks: 8.3 },
    { name: '[Sample] Series A Mock 2', provider: 'Series A', date: add(today, -21), type: 'mock', total_questions: 65, total_marks: 100, marks_obtained: 41.3, correct: 29, incorrect: 22, negative_marks: 7.3 },
    { name: '[Sample] Series A Mock 3', provider: 'Series A', date: add(today, -8), type: 'mock', total_questions: 65, total_marks: 100, marks_obtained: 49.0, correct: 33, incorrect: 18, negative_marks: 6.0 },
    { name: '[Sample] Series B Mock 1', provider: 'Series B', date: add(today, -14), type: 'mock', total_questions: 65, total_marks: 100, marks_obtained: 58.7, correct: 38, incorrect: 14, negative_marks: 4.7 },
    { name: '[Sample] Thermo Topic Test', provider: 'Series A', date: add(today, -18), type: 'topic', total_questions: 20, total_marks: 30, marks_obtained: 17, correct: 11, incorrect: 7, breakdown: [{ subject_id: th.id, topic_id: T(th, 5).id, correct: 4, incorrect: 3 }, { subject_id: th.id, topic_id: T(th, 3).id, correct: 7, incorrect: 4 }] },
  ];
  const tid = [];
  for (const t of tests) tid.push((await api('POST', '/api/tests', t)).id);

  // [subject, topic index, cause, question, solution, lesson, difficulty, marksLost, severity, confidence, test index, daysAgo, review plan]
  // plan letters: I=independent, P=partial, H=hint, F=failed, R=recurred
  const rows = [
    [th, 5, 'Conceptual', 'Entropy change of an ideal gas in an irreversible adiabatic expansion into vacuum (free expansion).', 'Entropy is a state function: ΔS = nR ln(V2/V1) > 0 even though q = 0.', 'Use a reversible path between the same end states.', 'medium', 2, 4, 4, 0, 35, 'FIIH'],
    [th, 3, 'Application', 'Steady-flow energy equation for a throttling valve: what stays constant?', 'Enthalpy (h1 = h2); no work, negligible heat and KE change.', 'Throttle = isenthalpic.', 'easy', 1, 3, 3, 1, 21, 'FP'],
    [th, 8, 'Recall', 'Otto cycle efficiency as a function of compression ratio and γ.', 'η = 1 − 1/r^(γ−1).', 'Otto: r^(γ−1). Diesel adds the cut-off term.', 'medium', 0.67, 3, 4, 2, 8, ''],
    [mm, 2, 'Calculation', 'Mohr’s circle: principal stresses for σx=80, σy=20, τxy=30 MPa.', 'Centre 50, R = √(30²+30²)=42.4 → σ1=92.4, σ2=7.6 MPa.', 'Centre = mean, R = √(((σx−σy)/2)²+τ²).', 'medium', 2, 4, 4, 0, 35, 'FFIH'],
    [mm, 7, 'Unit or sign', 'Torsion of a solid shaft: shear stress at surface for T=500 N·m, d=40 mm.', 'τ = 16T/(πd³) = 39.8 MPa (convert mm to m before substituting).', 'Convert to N and mm (or N·m and m) consistently.', 'medium', 1.33, 3, 4, 2, 21, 'IIR'],
    [mm, 7, 'Misreading', 'Hollow vs solid shaft: asked for the ratio of torque capacities at equal weight.', 'Equal weight ⇒ equal area; hollow shaft carries more torque.', 'Underline the constraint (equal weight vs equal diameter).', 'hard', 2, 4, 3, 2, 8, ''],
    [mm, 5, 'Calculation', 'Deflection at the free end of a cantilever with UDL.', 'δ = wL⁴/(8EI).', 'Memorise: point load PL³/3EI, UDL wL⁴/8EI.', 'easy', 0.67, 2, 5, 1, 21, 'IIII'],
    [fm, 6, 'Application', 'Bernoulli between two pipe sections of different diameter.', 'Use continuity to get v2 first, then Bernoulli for pressure.', 'Continuity first, then Bernoulli.', 'medium', 2, 4, 4, 2, 8, 'IR'],
    [fm, 13, 'Conceptual', 'Choked flow in a converging nozzle — what limits mass flow?', 'Once throat Mach = 1, lowering back pressure does not raise the flow.', 'Choked at M=1: flow depends on stagnation conditions only.', 'hard', 2, 5, 2, 0, 35, 'FI'],
    [tom, 2, 'Application', 'Gear train: speed of the output for a simple compound train.', 'Product of driver teeth / product of driven teeth.', 'Ratio = ∏driven / ∏driver (watch idlers).', 'medium', 1, 3, 3, 3, 14, 'IIIF'],
    [tom, 5, 'Recall', 'Static balancing condition for rotating masses in one plane.', 'ΣmrΩ² vector sum = 0.', 'Vector polygon of m·r must close.', 'easy', 0.67, 2, 4, 3, 14, 'II'],
    [md, 2, 'Conceptual', 'Goodman line vs Soderberg line for fatigue design.', 'Goodman uses ultimate strength (less conservative); Soderberg uses yield.', 'Soderberg = most conservative.', 'hard', 2, 4, 3, 1, 21, 'HIF'],
    [md, 1, 'Recall', 'Which failure theory suits ductile materials under combined stress?', 'Maximum distortion energy (von Mises) / max shear stress (Tresca).', 'Ductile: Tresca or von Mises. Brittle: max principal.', 'easy', 1, 3, 3, 2, 8, ''],
    [ht, 1, 'Calculation', 'Heat loss through a composite wall using thermal resistances.', 'Q = ΔT / ΣR, with R = L/(kA).', 'Series resistances add.', 'medium', 1.33, 3, 4, 2, 8, 'I'],
    [ht, 7, 'Application', 'LMTD vs NTU: which method when outlet temperatures are unknown?', 'NTU–effectiveness; LMTD needs the outlet temperatures.', 'Unknown outlets → ε-NTU.', 'medium', 2, 4, 3, 3, 14, 'P'],
    [em, 1, 'Unit or sign', 'Block on an incline with friction: direction of friction force on a block about to slide down.', 'Friction acts up the incline; N = mg cosθ.', 'Draw the FBD with a sign convention first.', 'easy', 1, 3, 5, 2, 8, 'IR'],
    [mach, 6, 'Time pressure', 'Taylor tool life equation: change in tool life for a 20% increase in cutting speed.', 'VTⁿ = C ⇒ T2/T1 = (V1/V2)^(1/n).', 'Practise Taylor’s equation ratios quickly.', 'medium', 1.33, 2, 3, 2, 8, ''],
    [orr, 0, 'Conceptual', 'Simplex: how to detect an unbounded LP from the tableau.', 'Entering column has no positive entries in the ratio test.', 'No positive pivot-column entry ⇒ unbounded.', 'hard', 2, 4, 2, 3, 14, 'P'],
    [orr, 5, 'Calculation', 'PERT: expected time and variance of an activity (a=2, m=4, b=12).', 'te = (a+4m+b)/6 = 5; σ² = ((b−a)/6)² = 2.78.', 'te=(a+4m+b)/6, variance ((b−a)/6)².', 'easy', 0.67, 2, 4, 0, 35, 'II'],
  ].filter((r) => r[0]);

  let n = 0;
  for (const [subj, ti, cause, q, sol, lesson, diff, lost, sev, conf, tIdx, ago, plan] of rows) {
    const date = add(today, -ago);
    const m = await api('POST', '/api/mistakes', {
      subject_id: subj.id, topic_id: T(subj, ti)?.id, cause_primary: C(cause), question_text: q, solution: sol, lesson, difficulty: diff,
      marks_lost: lost, severity: sev, confidence: conf, time_spent_sec: 60 + ((n * 37) % 240), test_id: tid[tIdx], date_encountered: date,
      question_no: String(3 + ((n * 7) % 60)), tags: [TAG], guessed: n % 6 === 0, skipped_solvable: n % 9 === 0,
    });
    // replay the review plan on each scheduled day (some a day late), only for days that have already happened
    let cur = m;
    for (const ch of plan) {
      const d = cur.next_review <= today ? cur.next_review : null;
      if (!d) break;
      const date2 = n % 3 === 0 && add(d, 1) <= today ? add(d, 1) : d;
      cur = await api('POST', `/api/mistakes/${m.id}/reviews`, { outcome: { I: 'independent', P: 'partial', H: 'hint', F: 'failed', R: 'recurred' }[ch], date: date2 });
    }
    n++;
  }

  const plan = [['Study: Mohr’s circle & combined stresses', mm, 'study', 90], ['Revise: Thermodynamic cycles', th, 'revision', 60], ['Series A Mock 4', null, 'mock', 180], ['Mock analysis', null, 'analysis', 90], ['PYQ set: Fluid Mechanics', fm, 'pyq', 60], ['Study: Gear trains', tom, 'study', 75], ['Revise: Heat exchangers', ht, 'revision', 60]];
  for (let i = 0; i < plan.length; i++) {
    const [title, subj, kind, minutes] = plan[i];
    const t = await api('POST', '/api/tasks', { date: add(today, i - 2), title: `[Sample] ${title}`, subject_id: subj?.id, kind, minutes });
    if (add(today, i - 2) < today) await api('PUT', `/api/tasks/${t.id}`, { done: i % 3 !== 0 });
  }
  const subs = [th, mm, fm, tom, md, ht, em].filter(Boolean);
  for (let d = 24; d >= 0; d--) {
    if ((d * 7) % 5 === 0) continue; // a few rest days
    await api('POST', '/api/log', { date: add(today, -d), subject_id: subs[d % subs.length].id, minutes: 60 + ((d * 25) % 200), activity: ['Study', 'Revision', 'Practice', 'PYQ'][d % 4], note: TAG });
  }
  for (const [subj, count] of [[th, 7], [mm, 9], [fm, 6], [em, 5], [tom, 4]]) {
    if (!subj) continue;
    for (const [i, t] of b.topics.filter((t) => t.subject_id === subj.id && !t.parent_id).slice(0, count).entries()) await api('PUT', `/api/progress/${t.id}`, { studied: true, revision_count: i % 3, pyq_done: i % 4 === 0, notes: TAG });
  }
  console.log(`Loaded ${rows.length} sample mistakes (with review history), ${tests.length} tests, tasks, a study log and checklist progress.`);
  console.log('Remove it any time with: node scripts/sample-data.js --remove');
  void mt;
}
main().catch((e) => { console.error(e.message); process.exit(1); });
