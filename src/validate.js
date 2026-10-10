// Small schema validator. spec: { field: { t, req, min, max, values, len } }
// Types: str, int, num, date, enum, bool, intarr, strarr, json
import { isDate } from '../public/shared/dates.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('; '));
    this.errors = errors;
    this.status = 400;
  }
}

export function validate(spec, input, { partial = false } = {}) {
  const out = {};
  const errors = {};
  for (const [k, s] of Object.entries(spec)) {
    let v = input[k];
    if (v === undefined) {
      if (s.req && !partial) errors[k] = 'is required';
      continue;
    }
    if (v === null || v === '') {
      if (s.req) errors[k] = 'is required';
      else out[k] = s.t === 'bool' ? 0 : s.t === 'intarr' || s.t === 'strarr' ? [] : null;
      continue;
    }
    switch (s.t) {
      case 'str':
        v = String(v);
        if (v.length > (s.len || 20000)) errors[k] = `too long (max ${s.len || 20000})`;
        else out[k] = v;
        break;
      case 'int':
      case 'num': {
        const n = Number(v);
        if (!Number.isFinite(n) || (s.t === 'int' && !Number.isInteger(n))) errors[k] = `must be ${s.t === 'int' ? 'an integer' : 'a number'}`;
        else if (s.min !== undefined && n < s.min) errors[k] = `must be ≥ ${s.min}`;
        else if (s.max !== undefined && n > s.max) errors[k] = `must be ≤ ${s.max}`;
        else out[k] = n;
        break;
      }
      case 'date':
        if (!isDate(v)) errors[k] = 'must be a date YYYY-MM-DD';
        else out[k] = v;
        break;
      case 'enum':
        if (!s.values.includes(v)) errors[k] = `must be one of ${s.values.join(', ')}`;
        else out[k] = v;
        break;
      case 'bool':
        out[k] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
        break;
      case 'intarr':
        if (!Array.isArray(v) || v.some((x) => !Number.isInteger(Number(x)))) errors[k] = 'must be a list of integers';
        else out[k] = v.map(Number);
        break;
      case 'strarr':
        if (!Array.isArray(v)) errors[k] = 'must be a list';
        else out[k] = v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
        break;
      case 'json':
        out[k] = v;
        break;
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const TEST_TYPES = ['topic', 'subject', 'mock', 'pyq', 'practice'];

export const MISTAKE_SPEC = {
  date_encountered: { t: 'date' },
  subject_id: { t: 'int', req: true },
  topic_id: { t: 'int' },
  subtopic_id: { t: 'int' },
  test_type: { t: 'enum', values: TEST_TYPES },
  provider: { t: 'str', len: 200 },
  test_name: { t: 'str', len: 300 },
  test_no: { t: 'str', len: 50 },
  test_id: { t: 'int' },
  question_no: { t: 'str', len: 50 },
  reference: { t: 'str', len: 1000 },
  question_text: { t: 'str' },
  attachment: { t: 'str', len: 300 },
  my_answer: { t: 'str' },
  correct_answer: { t: 'str' },
  solution: { t: 'str' },
  cause_primary: { t: 'int', req: true },
  causes_secondary: { t: 'intarr' },
  difficulty: { t: 'enum', values: DIFFICULTIES },
  confidence: { t: 'int', min: 1, max: 5 },
  time_spent_sec: { t: 'int', min: 0, max: 86400 },
  marks_lost: { t: 'num', min: 0, max: 1000 },
  severity: { t: 'int', min: 1, max: 5 },
  tags: { t: 'strarr' },
  lesson: { t: 'str' },
  guessed: { t: 'bool' },
  skipped_solvable: { t: 'bool' },
  archived: { t: 'bool' },
  next_review_override: { t: 'date' },
};

export const TEST_SPEC = {
  name: { t: 'str', req: true, len: 300 },
  provider: { t: 'str', len: 200 },
  date: { t: 'date', req: true },
  type: { t: 'enum', values: TEST_TYPES },
  duration_min: { t: 'num', min: 0, max: 1000 },
  total_questions: { t: 'int', min: 0, max: 1000 },
  total_marks: { t: 'num', min: 0, max: 10000 },
  marks_obtained: { t: 'num', min: -1000, max: 10000 },
  correct: { t: 'int', min: 0, max: 1000 },
  incorrect: { t: 'int', min: 0, max: 1000 },
  unattempted: { t: 'int', min: 0, max: 1000 },
  negative_marks: { t: 'num', min: 0, max: 1000 },
  breakdown: { t: 'json' },
  notes: { t: 'str' },
};

export const TASK_KINDS = ['study', 'revision', 'mock', 'pyq', 'analysis', 'other'];
export const TASK_SPEC = {
  date: { t: 'date', req: true },
  title: { t: 'str', req: true, len: 300 },
  subject_id: { t: 'int' },
  topic_id: { t: 'int' },
  kind: { t: 'enum', values: TASK_KINDS },
  minutes: { t: 'int', min: 0, max: 1440 },
  done: { t: 'bool' },
  notes: { t: 'str' },
};

export const LOG_SPEC = {
  date: { t: 'date', req: true },
  subject_id: { t: 'int' },
  minutes: { t: 'int', req: true, min: 1, max: 1440 },
  activity: { t: 'str', len: 100 },
  note: { t: 'str', len: 1000 },
};

export function cleanBreakdown(b) {
  if (b == null) return [];
  if (!Array.isArray(b)) throw new ValidationError({ breakdown: 'must be a list' });
  return b.map((r, i) => {
    const row = {};
    for (const k of ['subject_id', 'topic_id', 'attempted', 'correct', 'incorrect']) {
      if (r[k] === undefined || r[k] === null || r[k] === '') continue;
      const n = Number(r[k]);
      if (!Number.isInteger(n) || n < 0) throw new ValidationError({ breakdown: `row ${i + 1}: ${k} must be a non-negative integer` });
      row[k] = n;
    }
    if (!row.subject_id) throw new ValidationError({ breakdown: `row ${i + 1}: subject is required` });
    if ((row.correct || 0) + (row.incorrect || 0) > 1000) throw new ValidationError({ breakdown: `row ${i + 1}: too many questions` });
    return row;
  });
}
