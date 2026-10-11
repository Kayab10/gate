// Branch templates (DA and ME): syllabus and root causes. Each user gets their own copy when they pick a branch (see seedBranch in db.js);
// everything is editable in Settings and edits never affect other users.
// Syllabus source: the official GATE 2027 syllabi (DA and ME), IIT Madras. Each area becomes a subject (grouped by its
// section) and each item listed in the syllabus becomes a topic.
export const STREAMS = [
  {
    code: 'DA',
    name: 'Data Science and Artificial Intelligence',
    syllabus: [
      [null, 'Probability and Statistics', [
        'Counting: permutations and combinations', 'Probability axioms and sample spaces', 'Events, independence, mutual exclusivity',
        'Marginal, conditional and joint probability', 'Bayes’ theorem', 'Conditional expectation and variance',
        'Mean, median, mode and standard deviation', 'Correlation and covariance', 'Random variables',
        'Discrete random variables and PMFs', 'Bernoulli and binomial distributions', 'Continuous random variables and PDFs',
        'Uniform, exponential, Poisson, normal and standard normal', 't and chi-squared distributions', 'Cumulative distribution functions',
        'Conditional PDFs', 'Central Limit Theorem', 'Confidence intervals', 'z-test, t-test and chi-squared test']],
      [null, 'Linear Algebra', [
        'Vector spaces and subspaces', 'Linear dependence and independence', 'Matrices and matrix properties',
        'Projection, orthogonal, idempotent and partition matrices', 'Quadratic forms', 'Systems of linear equations', 'Gaussian elimination',
        'Eigenvalues and eigenvectors', 'Determinants, rank and nullity', 'Projections', 'LU decomposition', 'Singular Value Decomposition']],
      [null, 'Calculus and Optimization', [
        'Functions of a single variable', 'Limits, continuity and differentiability', 'Taylor series', 'Maxima and minima', 'Single-variable optimization']],
      [null, 'Programming, Data Structures and Algorithms', [
        'Python programming', 'Stacks and queues', 'Linked lists', 'Trees and hash tables', 'Linear and binary search',
        'Basic sorting: selection, bubble, insertion', 'Divide and conquer: mergesort, quicksort', 'Introduction to graph theory',
        'Graph traversal algorithms', 'Shortest-path algorithms']],
      [null, 'Database Management and Warehousing', [
        'ER model', 'Relational model and relational algebra', 'Tuple calculus', 'SQL', 'Integrity constraints', 'Normal forms and normalization',
        'File organization', 'Indexing', 'Data types', 'Data transformation', 'Normalization and discretization', 'Sampling and compression',
        'Multidimensional data models', 'Concept hierarchies', 'Measures and categorization']],
      [null, 'Machine Learning', [
        'Regression and classification', 'Simple and multiple linear regression', 'Ridge regression', 'Logistic regression', 'k-nearest neighbours',
        'Naive Bayes', 'Linear discriminant analysis', 'Support Vector Machines', 'Decision trees', 'Bias–variance trade-off',
        'Leave-one-out and k-fold cross-validation', 'Multilayer perceptrons', 'Feed-forward neural networks', 'K-means and k-medoids',
        'Hierarchical clustering: top-down and bottom-up', 'Single-linkage and multiple-linkage clustering', 'Dimensionality reduction', 'Principal Component Analysis']],
      [null, 'Artificial Intelligence', [
        'Uninformed search', 'Informed search', 'Adversarial search', 'Propositional logic', 'Predicate logic', 'Reasoning under uncertainty',
        'Conditional independence', 'Representation', 'Exact inference: variable elimination', 'Approximate inference: sampling']],
      [null, 'General Aptitude', ['Verbal ability', 'Numerical ability', 'Analytical reasoning', 'Spatial reasoning']],
    ],
  },
  {
    code: 'ME',
    name: 'Mechanical Engineering',
    syllabus: [
      ['Engineering Mathematics', 'Linear Algebra', ['Matrix algebra', 'Systems of linear equations', 'Eigenvalues and eigenvectors']],
      ['Engineering Mathematics', 'Calculus', [
        'Functions of a single variable', 'Limit, continuity and differentiability', 'Mean value theorems', 'Indeterminate forms',
        'Definite and improper integrals', 'Double and triple integrals', 'Partial and total derivatives', 'Taylor series (one and two variables)',
        'Maxima and minima', 'Fourier series', 'Gradient, divergence and curl', 'Vector identities', 'Directional derivatives',
        'Line, surface and volume integrals', 'Gauss, Stokes and Green’s theorems']],
      ['Engineering Mathematics', 'Differential Equations', [
        'First order equations (linear and nonlinear)', 'Higher order linear ODEs with constant coefficients', 'Euler–Cauchy equation',
        'Initial and boundary value problems', 'Laplace transforms', 'Heat, wave and Laplace’s equations']],
      ['Engineering Mathematics', 'Complex Variables', ['Analytic functions', 'Cauchy–Riemann equations', 'Cauchy’s integral theorem and formula', 'Taylor and Laurent series']],
      ['Engineering Mathematics', 'Probability and Statistics', [
        'Probability and conditional probability', 'Sampling theorems', 'Mean, median, mode and standard deviation', 'Random variables',
        'Binomial, Poisson and normal distributions']],
      ['Engineering Mathematics', 'Numerical Methods', [
        'Linear and non-linear algebraic equations', 'Integration: trapezoidal and Simpson’s rules', 'Single and multi-step methods for ODEs']],

      ['Applied Mechanics and Design', 'Engineering Mechanics', [
        'Free-body diagrams and equilibrium', 'Friction (rolling resistance, belt-pulley, brakes, clutches, screw jack, wedge)', 'Plane trusses and frames',
        'Virtual work', 'Kinematics and dynamics of rigid bodies in plane motion', 'Impulse and momentum (linear and angular)', 'Energy formulations']],
      ['Applied Mechanics and Design', 'Mechanics of Materials', [
        'Stress and strain, elastic constants', 'Stress and strain transformation in 2D', 'Mohr’s circle (plane stress and strain)', 'Thin-walled pressure vessels',
        'Shear force and bending moment diagrams', 'Bending and shear stresses; shear centre', 'Deflection of beams', 'Torsion of circular shafts',
        'Euler’s theory of columns', 'Energy methods', 'Thermal stresses', 'Strain gauges and rosettes', 'Mechanical properties: toughness, hardness, impact strength']],
      ['Applied Mechanics and Design', 'Theory of Machines', [
        'Displacement, velocity and acceleration analysis of mechanisms', 'Dynamic analysis of linkages', 'Cams', 'Gears and gear trains',
        'Flywheels and governors', 'Balancing of reciprocating and rotating masses', 'Gyroscope']],
      ['Applied Mechanics and Design', 'Vibrations', [
        'Free vibration (1 and 2 degrees of freedom)', 'Forced vibration', 'Damping estimation and effects', 'Vibration isolation and transmissibility',
        'Resonance', 'Critical speeds of shafts', 'Control systems, PID controller, transfer function']],
      ['Applied Mechanics and Design', 'Machine Design', [
        'Design for static and dynamic loading', 'Failure theories', 'Fatigue strength and the S-N diagram', 'Bolted, riveted and welded joints', 'Shafts',
        'Gears', 'Belt drives', 'Rolling and sliding contact bearings', 'Brakes and clutches', 'Springs']],

      ['Fluid Mechanics and Thermal Sciences', 'Fluid Mechanics', [
        'Fluid properties', 'Fluid statics; submerged bodies; stability of floating bodies', 'Control-volume analysis (mass, momentum, energy)', 'Fluid acceleration',
        'Differential equations of continuity and momentum', 'Velocity potential', 'Bernoulli’s equation', 'Dimensional analysis', 'Viscous flow of incompressible fluids',
        'Boundary layer', 'Elementary turbulent flow', 'Flow through pipes; head losses', 'One-dimensional compressible flow', 'Converging and converging-diverging nozzles']],
      ['Fluid Mechanics and Thermal Sciences', 'Heat Transfer', [
        'Modes of heat transfer', 'One-dimensional conduction; resistance and electrical analogy', 'Fins', 'Unsteady conduction; lumped parameter system',
        'Thermal boundary layer', 'Free and forced convection: dimensionless parameters and correlations', 'Boiling and condensation',
        'Heat exchangers: LMTD and NTU', 'Radiation: Stefan–Boltzmann and Wien laws, view factors, radiation networks']],
      ['Fluid Mechanics and Thermal Sciences', 'Thermodynamics', [
        'Systems and processes', 'Properties of pure substances', 'Ideal and real gases', 'Zeroth, first and second laws', 'Work, heat, energy and entropy changes',
        'Analysis of closed and open systems', 'Property charts and tables', 'Availability and irreversibility', 'Thermodynamic relations']],
      ['Fluid Mechanics and Thermal Sciences', 'Thermal Applications', [
        'Power engineering: vapour and gas cycles, regeneration, reheat', 'IC engines: Otto, Diesel and dual cycles', 'Combustion basics: air-fuel ratio, equivalence ratio',
        'Refrigeration and heat pump cycles', 'Moist air, psychrometric chart and processes', 'Turbomachinery: impulse and reaction, velocity diagrams',
        'Pelton, Francis and Kaplan turbines', 'Steam and gas turbines', 'Air and gas compressors', 'Pumps and pump characteristics']],

      ['Materials, Manufacturing and Industrial Engineering', 'Engineering Materials', [
        'Crystal structure of common metals', 'Phase diagrams', 'Heat treatment', 'Metals and alloys, polymers, composites and ceramics', 'Engineering and true stress-strain diagrams']],
      ['Materials, Manufacturing and Industrial Engineering', 'Casting, Forming and Joining', [
        'Casting processes', 'Patterns, moulds and cores', 'Solidification, riser and gating design', 'Casting defects', 'Plastic deformation and yield criteria',
        'Hot and cold working', 'Bulk and sheet forming; load estimation', 'Powder metallurgy', 'Welding, brazing and soldering', 'Solid-state welding; adhesive bonding',
        'Non-destructive testing']],
      ['Materials, Manufacturing and Industrial Engineering', 'Machining and Machine Tools', [
        'Basic machining operations and machine tools', 'Single-point and multipoint cutting tools', 'Single-point turning tool geometry: ASA and ORS', 'Mechanics of machining',
        'Cutting tool materials, tool life and wear', 'Economics of machining', 'Abrasive machining', 'Non-traditional machining', 'Work holding, jigs and fixtures']],
      ['Materials, Manufacturing and Industrial Engineering', 'Additive Manufacturing', ['Types of additive manufacturing processes', 'AM products: advantages, limitations and applications']],
      ['Materials, Manufacturing and Industrial Engineering', 'Metrology and Inspection', [
        'Limits, fits and tolerances', 'Linear and angular measurements', 'Comparators', 'Interferometry', 'Form and finish measurement', 'Alignment and testing methods',
        'Tolerance analysis in manufacturing and assembly', 'Coordinate-measuring machine (CMM)']],
      ['Materials, Manufacturing and Industrial Engineering', 'CAM and Automation', [
        'CAD/CAM concepts and integration', 'NC/CNC machines and CNC programming', 'Pneumatic, electro-pneumatic and hydraulic actuators', 'Programmable logic controllers']],
      ['Materials, Manufacturing and Industrial Engineering', 'Production Planning and Control', [
        'Work study', 'Productivity', 'Forecasting models', 'Aggregate production planning', 'Scheduling', 'Materials requirement planning', 'Six sigma',
        'Lean manufacturing', 'Inventory control: deterministic models, safety stock, systems', 'Quality and reliability']],
      ['Materials, Manufacturing and Industrial Engineering', 'Operations Research', [
        'Linear programming and the Simplex method', 'Transportation', 'Assignment', 'Network flow models', 'Simple queuing models', 'PERT and CPM']],

      // Every GATE paper carries General Aptitude (not part of the ME syllabus PDF; the topics are editable in Settings).
      ['General Aptitude', 'General Aptitude', ['Verbal ability', 'Numerical ability', 'Analytical reasoning', 'Spatial reasoning']],
    ],
  },
];

export const CAUSES = [
  ['Conceptual gap', 'I do not understand the underlying concept.',
    'Re-learn the concept from a primary source, write a 3-line summary in your own words, then solve 3 fresh problems on it before the next review.'],
  ['Recall failure', 'Studied it but could not recall the formula, property or theorem.',
    'Add the item to a one-page formula sheet, write it from memory without looking, and re-test it in the next review.'],
  ['Application failure', 'Know the concept but cannot see how to apply it.',
    'Solve 3–5 fresh problems that need the same concept in different disguises; write down the trigger that tells you to use it.'],
  ['Calculation error', 'Arithmetic or algebra mistake.',
    'Re-do the calculation by a second route (estimate, substitute back, units/limits check). Write intermediate steps instead of doing them mentally.'],
  ['Misreading', 'Misunderstood what the question asked.',
    'Underline what is asked and the constraints before solving; restate the question in one line. Check the final answer matches the quantity requested.'],
  ['Carelessness', 'Avoidable execution or attention error.',
    'Slow down on the last step; keep a pre-submit checklist (sign, units, option mapping, NAT format). Track whether it clusters at the end of a test.'],
  ['Time pressure', 'Could solve it but ran out of time.',
    'Practise this question type under a timer; learn the faster method. Set a per-question cutoff for the next mock.'],
  ['Question selection', 'Spent too long on an unproductive question.',
    'Decide a hard time cap per question and a skip rule (mark and return). Review which question types you should skip first.'],
  ['Guessing or uncertainty', 'Answered without sufficient justification.',
    'Treat as a knowledge gap: solve it properly, then note what would have let you eliminate options. Only guess when you can eliminate options.'],
  ['Coding or tracing error', 'Incorrectly traced an algorithm or Python behaviour (DA).',
    'Trace with a table of variable values per step; then run the code to compare. Note the language rule or edge case you missed.'],
  ['Unit or sign error', 'Wrong units, unit conversion or sign convention (ME).',
    'Write units on every line, fix a sign convention before starting (and draw it), and sanity-check the magnitude and direction of the answer.'],
  ['Knowledge gap in a subtopic', 'A specific part of the syllabus remains incomplete.',
    'Mark the topic as not studied in the Syllabus tracker, schedule a study block for it, and add fresh problems afterwards.'],
];
