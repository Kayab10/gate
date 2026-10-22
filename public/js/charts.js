// Tiny dependency-free SVG/HTML charts. They only draw what they are given.
import { esc } from './util.js';
import { shortDate } from '/shared/dates.js';

export const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

/** series: [{name, values:[number|null], color?}], labels: string[] (dates 'YYYY-MM-DD' are shortened) */
export function lineChart({ labels, series, yFormat = (v) => v, yMin = 0, yMax, height = 190, ariaLabel = 'Line chart', bridge = false }) {
  const W = 640, H = height, L = 38, R = 10, T = 10, B = 24;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!labels.length || !all.length) return '';
  const ints = all.every((v) => Number.isInteger(v)) && yMax === undefined;
  // whole-number data (counts) gets whole-number ticks: 0..4, or a multiple of 4
  const hi = ints ? Math.max(4, Math.ceil(Math.max(...all) / 4) * 4) : (yMax ?? Math.max(...all, 1) * 1.1);
  const lo = yMin;
  const x = (i) => L + (labels.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (labels.length - 1));
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end">${esc(yFormat(Math.round(v * 100) / 100))}</text>`;
  }
  const step = Math.ceil(labels.length / 8);
  labels.forEach((l, i) => {
    if (i % step === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(/^\d{4}-/.test(l) ? shortDate(l) : l)}</text>`;
  });
  const lines = series.map((s, si) => {
    const color = s.color || COLORS[si % COLORS.length];
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) return void (pen = bridge ? pen : false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    const dots = s.values.map((v, i) => (v == null ? '' : `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}"><title>${esc(s.name)} · ${esc(labels[i])}: ${esc(yFormat(Math.round(v * 100) / 100))}</title></circle>`)).join('');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${s.color || COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${g}${lines.join('')}</svg>${legend}`;
}

/** Horizontal bars as HTML. rows: [{label, value, text, cls}] */
export function barList(rows, max) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return '';
  return `<div class="bars">${rows
    .map((r) => `<div class="br"><span title="${esc(r.label)}">${esc(r.label)}</span><div class="track"><div class="fill ${r.cls || ''}" style="width:${m ? Math.min(100, (r.value / m) * 100) : 0}%"></div></div><span class="right">${esc(r.text ?? r.value)}</span></div>`)
    .join('')}</div>`;
}

export function sparkBars(values, color = 'var(--accent)', h = 36) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const w = 6, gap = 2;
  return `<svg width="${values.length * (w + gap)}" height="${h}" role="img" aria-label="Trend">${values.map((v, i) => `<rect x="${i * (w + gap)}" y="${h - (v / max) * (h - 2) - 1}" width="${w}" height="${Math.max(1, (v / max) * (h - 2))}" rx="1" fill="${color}"><title>${v}</title></rect>`).join('')}</svg>`;
}

/** Circular progress (0–1). The gradient is defined once in index.html (#ringGrad). */
export function ring(p, { r = 54 } = {}) {
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, p || 0));
  return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="rt" cx="60" cy="60" r="${r}"/><circle class="rp" data-ring cx="60" cy="60" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}" transform="rotate(-90 60 60)"/></svg>`;
}
export const ringOffset = (p, r = 54) => (2 * Math.PI * r * (1 - Math.max(0, Math.min(1, p || 0)))).toFixed(2);
