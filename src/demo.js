// Demo data so you can try the app with something in it, and remove it again.
// Everything created is tagged ("sample" tag, "[Sample]" names, note "sample") and only ever touches the signed-in
// user's own account. removeDemo() deletes just those rows and leaves everything you entered yourself.
import { addDays, isDate, todayStr } from '../public/shared/dates.js';

export const TAG = 'sample';
const PLAN = { I: 'independent', P: 'partial', H: 'hint', F: 'failed', R: 'recurred' };

// row: [subject, topic index, cause keyword, question, solution, lesson, difficulty, marks lost, severity, confidence, test #, days ago, review plan]
// review plan letters: I=independent P=partial H=hint F=failed R=recurred (replayed on each scheduled day that already happened)
const DATASETS = {
  ME: {
    tests: [
      ['Series A Mock 1', 'Series A', -35, 'mock', 34.7, 25, 24, 8.3],
      ['Series A Mock 2', 'Series A', -21, 'mock', 41.3, 29, 22, 7.3],
      ['Series A Mock 3', 'Series A', -8, 'mock', 49.0, 33, 18, 6.0],
      ['Series B Mock 1', 'Series B', -14, 'mock', 58.7, 38, 14, 4.7],
    ],
    rows: [
      ['Thermodynamics', 5, 'Conceptual', 'Entropy change of an ideal gas in free expansion into vacuum.', 'Entropy is a state function: ΔS = nR ln(V2/V1) > 0 even though q = 0.', 'Use a reversible path between the same end states.', 'medium', 2, 4, 4, 0, 35, 'FIIH'],
      ['Thermodynamics', 3, 'Application', 'Steady-flow energy equation for a throttling valve: what stays constant?', 'Enthalpy (h1 = h2); no work, negligible heat and KE change.', 'Throttle = isenthalpic.', 'easy', 1, 3, 3, 1, 21, 'FP'],
      ['Thermodynamics', 8, 'Recall', 'Otto cycle efficiency as a function of compression ratio and γ.', 'η = 1 − 1/r^(γ−1).', 'Otto: r^(γ−1). Diesel adds the cut-off term.', 'medium', 0.67, 3, 4, 2, 8, ''],
      ['Mechanics of Materials', 2, 'Calculation', 'Mohr’s circle: principal stresses for σx=80, σy=20, τxy=30 MPa.', 'Centre 50, R = √(30²+30²)=42.4 → σ1=92.4, σ2=7.6 MPa.', 'Centre = mean, R = √(((σx−σy)/2)²+τ²).', 'medium', 2, 4, 4, 0, 35, 'FFIH'],
      ['Mechanics of Materials', 7, 'Unit or sign', 'Torsion of a solid shaft: surface shear stress for T=500 N·m, d=40 mm.', 'τ = 16T/(πd³) = 39.8 MPa (convert mm to m before substituting).', 'Convert to N and mm (or N·m and m) consistently.', 'medium', 1.33, 3, 4, 2, 21, 'IIR'],
      ['Mechanics of Materials', 7, 'Misreading', 'Hollow vs solid shaft: ratio of torque capacities at equal weight.', 'Equal weight ⇒ equal area; the hollow shaft carries more torque.', 'Underline the constraint (equal weight vs equal diameter).', 'hard', 2, 4, 3, 2, 8, ''],
      ['Mechanics of Materials', 5, 'Calculation', 'Deflection at the free end of a cantilever with UDL.', 'δ = wL⁴/(8EI).', 'Point load PL³/3EI, UDL wL⁴/8EI.', 'easy', 0.67, 2, 5, 1, 21, 'IIII'],
      ['Fluid Mechanics', 6, 'Application', 'Bernoulli between two pipe sections of different diameter.', 'Use continuity to get v2 first, then Bernoulli for pressure.', 'Continuity first, then Bernoulli.', 'medium', 2, 4, 4, 2, 8, 'IR'],
      ['Fluid Mechanics', 13, 'Conceptual', 'Choked flow in a converging nozzle — what limits mass flow?', 'Once throat Mach = 1, lowering back pressure does not raise the flow.', 'Choked at M=1: flow depends on stagnation conditions only.', 'hard', 2, 5, 2, 0, 35, 'FI'],
      ['Theory of Machines', 2, 'Application', 'Gear train: output speed of a simple compound train.', 'Product of driver teeth / product of driven teeth.', 'Ratio = ∏driven / ∏driver (watch idlers).', 'medium', 1, 3, 3, 3, 14, 'IIIF'],
      ['Theory of Machines', 5, 'Recall', 'Static balancing condition for rotating masses in one plane.', 'ΣmrΩ² vector sum = 0.', 'The vector polygon of m·r must close.', 'easy', 0.67, 2, 4, 3, 14, 'II'],
      ['Machine Design', 2, 'Conceptual', 'Goodman line vs Soderberg line for fatigue design.', 'Goodman uses ultimate strength (less conservative); Soderberg uses yield.', 'Soderberg = most conservative.', 'hard', 2, 4, 3, 1, 21, 'HIF'],
      ['Machine Design', 1, 'Recall', 'Which failure theory suits ductile materials under combined stress?', 'Maximum distortion energy (von Mises) / max shear stress (Tresca).', 'Ductile: Tresca or von Mises. Brittle: max principal.', 'easy', 1, 3, 3, 2, 8, ''],
      ['Heat Transfer', 1, 'Calculation', 'Heat loss through a composite wall using thermal resistances.', 'Q = ΔT / ΣR, with R = L/(kA).', 'Series resistances add.', 'medium', 1.33, 3, 4, 2, 8, 'I'],
      ['Heat Transfer', 7, 'Application', 'LMTD vs NTU: which method when outlet temperatures are unknown?', 'NTU–effectiveness; LMTD needs the outlet temperatures.', 'Unknown outlets → ε-NTU.', 'medium', 2, 4, 3, 3, 14, 'P'],
      ['Engineering Mechanics', 1, 'Unit or sign', 'Block about to slide down an incline: direction of the friction force.', 'Friction acts up the incline; N = mg cosθ.', 'Draw the FBD with a sign convention first.', 'easy', 1, 3, 5, 2, 8, 'IR'],
      ['Machining and Machine Tools', 6, 'Time pressure', 'Taylor tool life: change in tool life for a 20% increase in cutting speed.', 'VTⁿ = C ⇒ T2/T1 = (V1/V2)^(1/n).', 'Practise Taylor’s equation ratios quickly.', 'medium', 1.33, 2, 3, 2, 8, ''],
      ['Operations Research', 0, 'Conceptual', 'Simplex: how to detect an unbounded LP from the tableau.', 'The entering column has no positive entries in the ratio test.', 'No positive pivot-column entry ⇒ unbounded.', 'hard', 2, 4, 2, 3, 14, 'P'],
      ['Operations Research', 5, 'Calculation', 'PERT: expected time and variance of an activity (a=2, m=4, b=12).', 'te = (a+4m+b)/6 = 5; σ² = ((b−a)/6)² = 2.78.', 'te=(a+4m+b)/6, variance ((b−a)/6)².', 'easy', 0.67, 2, 4, 0, 35, 'II'],
    ],
    tasks: [['Study: Mohr’s circle & combined stresses', 'Mechanics of Materials', 'study', 90], ['Revise: Thermodynamic cycles', 'Thermodynamics', 'revision', 60], ['Series A Mock 4', null, 'mock', 180], ['Mock analysis', null, 'analysis', 90], ['PYQ set: Fluid Mechanics', 'Fluid Mechanics', 'pyq', 60], ['Study: Gear trains', 'Theory of Machines', 'study', 75], ['Revise: Heat exchangers', 'Heat Transfer', 'revision', 60]],
    logSubjects: ['Thermodynamics', 'Mechanics of Materials', 'Fluid Mechanics', 'Theory of Machines', 'Machine Design', 'Heat Transfer', 'Engineering Mechanics'],
    progress: [['Thermodynamics', 7], ['Mechanics of Materials', 9], ['Fluid Mechanics', 6], ['Engineering Mechanics', 5], ['Theory of Machines', 4]],
  },
  DA: {
    tests: [
      ['Series A Mock 1', 'Series A', -35, 'mock', 34.7, 25, 24, 8.3],
      ['Series A Mock 2', 'Series A', -21, 'mock', 41.3, 29, 22, 7.3],
      ['Series A Mock 3', 'Series A', -8, 'mock', 49.0, 33, 18, 6.0],
      ['Series B Mock 1', 'Series B', -14, 'mock', 58.7, 38, 14, 4.7],
    ],
    rows: [
      ['Machine Learning', 7, 'Conceptual', 'For a soft-margin SVM, what happens to the margin and training error as C increases?', 'Larger C penalises slack more: narrower margin, fewer margin violations, higher variance.', 'C large = narrow margin, low bias, high variance.', 'medium', 2, 4, 4, 0, 35, 'FIIH'],
      ['Machine Learning', 7, 'Conceptual', 'Why does the kernel trick avoid computing φ(x) explicitly?', 'The dual only needs inner products, which K(x,y)=φ(x)·φ(y) gives directly.', 'The dual form only uses dot products.', 'hard', 2, 5, 3, 1, 21, 'FP'],
      ['Machine Learning', 1, 'Calculation', 'Ridge regression solution for XᵀX = [[2,0],[0,3]], Xᵀy = [4,6], λ = 1.', 'w = (XᵀX + λI)⁻¹Xᵀy = [4/3, 3/2].', 'Add λ to the diagonal before inverting.', 'medium', 0.67, 3, 4, 2, 8, ''],
      ['Machine Learning', 9, 'Application', 'High variance, low bias model. Which remedy applies?', 'More data or regularisation reduces variance.', 'Overfit → regularise / more data.', 'easy', 1, 3, 3, 3, 14, 'IIIIII'],
      ['Machine Learning', 13, 'Recall', 'K-means objective and why it always converges?', 'Minimises within-cluster squared distance; each step cannot increase it and states are finite.', 'Both steps monotonically decrease the objective.', 'medium', 0.67, 2, 4, 3, 14, 'IIIF'],
      ['Probability and Statistics', 3, 'Conceptual', 'Bayes: P(disease|+) with 1% prevalence, 95% sensitivity, 90% specificity.', 'P = 0.0095 / (0.0095 + 0.099) ≈ 8.8%.', 'Always compute the false-positive mass.', 'medium', 2, 5, 5, 0, 35, 'FFIH'],
      ['Probability and Statistics', 3, 'Misreading', 'The question asked P(A|B) but I computed P(B|A).', 'Re-read which event is conditioned on.', 'Underline the given event.', 'easy', 1.33, 3, 4, 2, 21, 'IIR'],
      ['Probability and Statistics', 10, 'Calculation', 'Binomial(10, 0.3): P(X ≥ 2)?', '1 − P(0) − P(1) = 1 − 0.0282 − 0.1211 = 0.8507.', 'Use the complement for "at least".', 'medium', 0.67, 3, 4, 2, 8, 'I'],
      ['Probability and Statistics', 15, 'Application', 'Sample mean of n=36 from σ=12: P(|X̄−μ|>2)?', 'SE = 2 → z = 1 → 2(1−Φ(1)) ≈ 0.317.', 'SE = σ/√n, then standardise.', 'medium', 2, 4, 3, 2, 8, ''],
      ['Probability and Statistics', 4, 'Carelessness', 'Var(aX+b) — forgot to square a.', 'Var = a²Var(X).', 'Variance squares the coefficient; a shift does nothing.', 'easy', 0.67, 2, 5, 1, 21, 'IIII'],
      ['Linear Algebra', 7, 'Application', 'Eigenvalues of [[4,1],[2,3]] and a trace/determinant check.', 'λ = 2, 5. Sum = trace = 7, product = det = 10.', 'Check with trace & determinant.', 'easy', 1, 3, 4, 0, 35, 'IIIIF'],
      ['Linear Algebra', 11, 'Conceptual', 'Rank of A and the number of non-zero singular values.', 'They are equal.', 'rank = number of non-zero singular values.', 'hard', 2, 4, 2, 1, 21, 'F'],
      ['Linear Algebra', 8, 'Calculation', 'Determinant of a 3×3 by cofactor expansion — sign slip.', 'Alternate signs +,−,+ along the row.', 'Write the sign matrix first.', 'medium', 0.67, 2, 4, 3, 14, 'I'],
      ['Linear Algebra', 5, 'Recall', 'Condition for a quadratic form to be positive definite.', 'All eigenvalues > 0 (equivalently all leading minors > 0).', 'PD ⇔ all eigenvalues positive.', 'easy', 1, 3, 3, 2, 8, ''],
      ['Programming, Data Structures and Algorithms', 0, 'Coding or tracing', 'Python: list aliasing, b = a; b.append(1); print(a).', 'b and a refer to the same list, so a also changes.', 'Assignment aliases; copy() clones.', 'easy', 1, 3, 5, 2, 8, 'IR'],
      ['Programming, Data Structures and Algorithms', 9, 'Application', 'Dijkstra with a negative edge — why does it fail?', 'Settled nodes can later get shorter paths; use Bellman–Ford.', 'Negative edge ⇒ not Dijkstra.', 'medium', 2, 4, 3, 1, 21, 'HIF'],
      ['Programming, Data Structures and Algorithms', 6, 'Time pressure', 'Merge sort recurrence T(n)=2T(n/2)+n — solved but too slowly.', 'Master theorem case 2: Θ(n log n).', 'Memorise the three master-theorem cases.', 'medium', 1.33, 2, 3, 2, 8, ''],
      ['Database Management and Warehousing', 5, 'Conceptual', 'Can a relation be in BCNF but not in 3NF?', 'No: BCNF is strictly stronger than 3NF.', 'BCNF ⇒ 3NF, not the reverse.', 'hard', 2, 4, 3, 0, 35, 'FI'],
      ['Database Management and Warehousing', 3, 'Misreading', 'SQL: used WHERE with an aggregate instead of HAVING.', 'Aggregates are filtered in HAVING after GROUP BY.', 'WHERE = rows, HAVING = groups.', 'easy', 0.67, 2, 4, 3, 14, 'II'],
      ['Artificial Intelligence', 1, 'Conceptual', 'A* is optimal when the heuristic is…?', 'Admissible (and consistent for graph search).', 'Admissible = never overestimates.', 'medium', 1, 3, 3, 2, 8, ''],
      ['Artificial Intelligence', 8, 'Calculation', 'Variable elimination order and factor sizes.', 'Eliminating the variable with the fewest neighbours keeps factors small.', 'Min-degree elimination order.', 'hard', 2, 4, 2, 3, 14, 'P'],
      ['Calculus and Optimization', 3, 'Application', 'Find the max of f(x)=x³−3x on [−2,2].', 'f′=0 at x=±1; check endpoints: the max is 2 at x=−1 and at x=2.', 'Always test the endpoints.', 'medium', 1, 3, 4, 3, 14, 'IIIF'],
      ['Calculus and Optimization', 2, 'Recall', 'Taylor expansion of eˣ and its remainder.', 'Σ xⁿ/n!, remainder e^c xⁿ⁺¹/(n+1)!.', 'Learn the standard series cold.', 'easy', 1, 2, 3, 0, 35, 'II'],
    ],
    tasks: [['Study: SVM dual & kernels', 'Machine Learning', 'study', 90], ['Revise: Bayes’ theorem problems', 'Probability and Statistics', 'revision', 60], ['Series A Mock 4', null, 'mock', 180], ['Mock analysis', null, 'analysis', 90], ['PYQ set: Linear Algebra', 'Linear Algebra', 'pyq', 60], ['Study: Graph algorithms', 'Programming, Data Structures and Algorithms', 'study', 75], ['Revise: SQL & normal forms', 'Database Management and Warehousing', 'revision', 60]],
    logSubjects: ['Machine Learning', 'Probability and Statistics', 'Linear Algebra', 'Programming, Data Structures and Algorithms', 'Database Management and Warehousing', 'Artificial Intelligence', 'Calculus and Optimization'],
    progress: [['Machine Learning', 9], ['Probability and Statistics', 12], ['Linear Algebra', 8], ['Calculus and Optimization', 4], ['Programming, Data Structures and Algorithms', 5]],
  },
};

/** Adds demo data to the chosen branch. Safe to call twice: the second call does nothing. */
export async function loadDemo(S, streamId, today) {
  today = isDate(today) ? today : todayStr();
  const b = await S.bootstrap(streamId);
  if (b.needsStream) throw Object.assign(new Error('Choose what you are studying first'), { status: 400 });
  if (b.mistakes.some((m) => m.tags.includes(TAG))) return { already: true, mistakes: 0 };
  const data = DATASETS[b.stream.code];
  if (!data) throw Object.assign(new Error(`There is no demo data for ${b.stream.code}`), { status: 400 });

  const subject = (name) => b.subjects.find((s) => s.name === name);
  const topicOf = (subj, i) => b.topics.filter((t) => t.subject_id === subj.id && !t.parent_id)[i];
  const cause = (kw) => b.causes.find((c) => new RegExp(kw, 'i').test(c.name)) || b.causes[0];

  return S.inTransaction(async () => {
    const testIds = [];
    for (const [name, provider, ago, type, marks, correct, incorrect, neg] of data.tests) {
      const t = await S.saveTest(null, { name: `[Sample] ${name}`, provider, date: addDays(today, ago), type, total_questions: 65, total_marks: 100, marks_obtained: marks, correct, incorrect, negative_marks: neg }, streamId);
      testIds.push(t.id);
    }
    let n = 0;
    for (const [subjName, ti, causeKw, question, solution, lesson, difficulty, marksLost, severity, confidence, testIdx, ago, plan] of data.rows) {
      const subj = subject(subjName);
      if (!subj) continue; // the user renamed or deleted that subject
      const m = await S.createMistake({
        subject_id: subj.id, topic_id: topicOf(subj, ti)?.id, cause_primary: cause(causeKw).id, question_text: question, solution, lesson, difficulty,
        marks_lost: marksLost, severity, confidence, time_spent_sec: 60 + ((n * 37) % 240), test_id: testIds[testIdx], date_encountered: addDays(today, -ago),
        question_no: String(3 + ((n * 7) % 60)), tags: [TAG], guessed: n % 6 === 0, skipped_solvable: n % 9 === 0,
      }, today);
      let cur = m;
      for (const ch of plan) {
        if (cur.next_review > today) break; // that review day hasn't happened yet
        const due = cur.next_review;
        const date = n % 3 === 0 && addDays(due, 1) <= today ? addDays(due, 1) : due; // some reviews a day late
        cur = await S.addReview(m.id, { outcome: PLAN[ch], date });
      }
      n++;
    }
    for (const [i, [title, subjName, kind, minutes]] of data.tasks.entries()) {
      const date = addDays(today, i - 2);
      const t = await S.saveTask(null, { date, title: `[Sample] ${title}`, subject_id: subject(subjName)?.id, kind, minutes }, 0, streamId);
      if (date < today) await S.saveTask(t.id, { done: i % 3 !== 0 });
    }
    const subs = data.logSubjects.map(subject).filter(Boolean);
    for (let d = 24; d >= 0; d--) {
      if ((d * 7) % 5 === 0) continue; // a few rest days
      await S.addLog({ date: addDays(today, -d), subject_id: subs[d % subs.length]?.id, minutes: 60 + ((d * 25) % 200), activity: ['Study', 'Revision', 'Practice', 'PYQ'][d % 4], note: TAG }, streamId);
    }
    for (const [subjName, count] of data.progress) {
      const subj = subject(subjName);
      if (!subj) continue;
      for (const [i, t] of b.topics.filter((x) => x.subject_id === subj.id && !x.parent_id).slice(0, count).entries()) {
        await S.putProgress(t.id, { studied: true, revision_count: i % 3, pyq_done: i % 4 === 0, notes: TAG });
      }
    }
    return { already: false, mistakes: n, tests: testIds.length };
  });
}

/** Deletes only the demo rows (in every branch of this account); your own entries stay. */
export async function removeDemo(S) {
  return S.inTransaction(async () => {
    let mistakes = 0, tests = 0, tasks = 0, log = 0, ticks = 0;
    for (const st of await S.listStreams()) {
      const b = await S.bootstrap(st.id);
      const ids = b.mistakes.filter((m) => m.tags.includes(TAG)).map((m) => m.id);
      if (ids.length) await S.bulk({ ids, action: 'delete' });
      mistakes += ids.length;
      for (const t of b.tests.filter((t) => t.name.startsWith('[Sample]'))) (await S.deleteTest(t.id), tests++);
      for (const t of b.tasks.filter((t) => t.title.startsWith('[Sample]'))) (await S.deleteTask(t.id), tasks++);
      for (const l of b.studyLog.filter((l) => l.note === TAG)) (await S.deleteLog(l.id), log++);
      for (const p of b.progress.filter((p) => p.notes === TAG)) (await S.putProgress(p.topic_id, { studied: false, revision_count: 0, pyq_done: false, notes: '' }), ticks++);
    }
    return { mistakes, tests, tasks, log, ticks };
  });
}
