// Date helpers. All dates are local calendar dates as 'YYYY-MM-DD' strings.
// Arithmetic is done in UTC so daylight-saving changes can never shift a day.
const pad = (n) => String(n).padStart(2, '0');

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmt(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
}
export function addDays(s, n) {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return fmt(d);
}
/** a - b in whole days */
export function diffDays(a, b) {
  return Math.round((parse(a) - parse(b)) / 864e5);
}
/** Monday of the week containing s */
export function weekStart(s) {
  return addDays(s, -((parse(s).getUTCDay() + 6) % 7));
}
export function dayName(s) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parse(s).getUTCDay()];
}
export function shortDate(s) {
  const d = parse(s);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}
