// Dates are "YYYY-MM-DD" strings and times are 24-hour "HH:MM" strings everywhere in the app.
// All maths is done in UTC on purpose so a date never shifts because of timezones.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function parse(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
const fmt = (dt: Date) => dt.toISOString().slice(0, 10);

export function isValidDate(d: string) {
  return DATE_RE.test(d) && fmt(parse(d)) === d;
}

export function normTime(t: string) {
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${m}`;
}

export function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function fromMin(n: number) {
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

export function addDays(d: string, n: number) {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function diffDays(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);
}

export function weekday(d: string) {
  return parse(d).getUTCDay();
}

export function mondayOf(d: string) {
  return addDays(d, -((weekday(d) + 6) % 7));
}

/** "Wednesday, October 7" */
export function longDate(d: string) {
  const dt = parse(d);
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** "Wed, Oct 7" */
export function shortDate(d: string) {
  const dt = parse(d);
  return `${WEEKDAYS[dt.getUTCDay()].slice(0, 3)}, ${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCDate()}`;
}

/** "15:30" -> "3:30 pm" */
export function time12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "pm" : "am"}`;
}

export function minutesLabel(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** Today's date on the device running this code. */
export function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

export function localNowTime() {
  const n = new Date();
  return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

/** "17:00","19:00" -> "5–7 pm"; "07:30","15:00" -> "7:30 am–3 pm" */
export function compactRange(a: string, b: string) {
  const part = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return { text: m ? `${h % 12 || 12}:${pad(m)}` : `${h % 12 || 12}`, ap: h >= 12 ? "pm" : "am" };
  };
  const x = part(a);
  const y = part(b);
  return x.ap === y.ap ? `${x.text}–${y.text} ${y.ap}` : `${x.text} ${x.ap}–${y.text} ${y.ap}`;
}
