// Money, numbers and times. Pure functions, no DOM.

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const TZ = "Europe/Berlin";

export const MINUS = "−";

export function fmtInt(n) {
  return n == null || !Number.isFinite(n) ? "—" : intFmt.format(Math.round(n)).replace("-", MINUS);
}

// Compact counts for tight spots: 950, 12.4k, 1.2M
export function fmtCompact(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a < 10000) return fmtInt(n);
  if (a < 1e6) return trimZero((n / 1e3).toFixed(a < 1e5 ? 1 : 0)) + "k";
  return trimZero((n / 1e6).toFixed(1)) + "M";
}

function trimZero(s) {
  return s.replace(/\.0$/, "");
}

export function splitCopper(copper) {
  const c = Math.max(0, Math.round(copper));
  return { g: Math.floor(c / 10000), s: Math.floor(c / 100) % 100, c: c % 100 };
}

// [[value, "g"|"s"|"c"], ...]. Leading and trailing zero parts are dropped, a zero in the
// middle stays ("1g 0s 1c") so the reading is unambiguous. Copper goes above 100g, silver above 10,000g.
export function moneyParts(copper) {
  if (copper == null || !Number.isFinite(copper)) return [];
  const { g, s, c } = splitCopper(copper);
  const parts = [[g, "g"], [s, "s"], [c, "c"]];
  if (g >= 100) parts.pop();
  if (g >= 10000) parts.pop();
  while (parts.length > 1 && parts[0][0] === 0) parts.shift();
  while (parts.length > 1 && parts[parts.length - 1][0] === 0) parts.pop();
  return parts;
}

export function moneyText(copper) {
  const p = moneyParts(copper);
  if (!p.length) return "—";
  return p.map(([v, u]) => (u === "g" ? intFmt.format(v) : v) + u).join(" ");
}

const UNIT_WORD = { g: "gold", s: "silver", c: "copper" };
export function moneyLabel(copper) {
  const p = moneyParts(copper);
  if (!p.length) return "no price";
  return p.map(([v, u]) => `${u === "g" ? intFmt.format(v) : v} ${UNIT_WORD[u]}`).join(" ");
}

// What you'd type into the game's buyout field: always all three parts.
export function moneyGame(copper) {
  const { g, s, c } = splitCopper(copper);
  return `${g}g ${s}s ${c}c`;
}

// Fraction → "+12.5%", "−8%", "±0%". Above 100 % no decimals.
export function fmtPct(f, { sign = true } = {}) {
  if (f == null || !Number.isFinite(f)) return "—";
  const p = f * 100;
  if (Math.abs(p) < 0.5) return "±0%";
  const a = Math.abs(p);
  const num = a >= 100 ? intFmt.format(Math.round(a)) : trimZero(a.toFixed(1));
  const s = !sign ? (p < 0 ? MINUS : "") : p > 0 ? "+" : MINUS;
  return s + num + "%";
}

export function changeDir(f) {
  if (f == null || !Number.isFinite(f) || Math.abs(f) < 0.005) return 0;
  return f > 0 ? 1 : -1;
}

// ---- time (Europe/Berlin) ----

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Berlin wall-clock parts of a unix time
export function berlin(t) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(t * 1000))) o[p.type] = p.value;
  const y = +o.year, mo = +o.month, d = +o.day;
  return { y, mo, d, h: +o.hour, mi: +o.minute, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

const pad = (n) => String(n).padStart(2, "0");

export function fmtClock(t) {
  const b = berlin(t);
  return `${pad(b.h)}:${pad(b.mi)}`;
}

export function fmtDay(t, { weekday = false } = {}) {
  const b = berlin(t);
  return `${weekday ? dayNames[b.dow] + " " : ""}${b.d} ${monthNames[b.mo - 1]}`;
}

export function fmtDateTime(t) {
  return `${fmtDay(t)}, ${fmtClock(t)}`;
}

function dayNumber(t) {
  const b = berlin(t);
  return Date.UTC(b.y, b.mo - 1, b.d) / 86400000;
}

export function relTime(t, now) {
  if (t == null) return "—";
  const d = now - t;
  if (d < 120) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 6 * 3600) return `${Math.floor(d / 3600)} h ago`;
  const days = dayNumber(now) - dayNumber(t);
  if (days === 0) return `today ${fmtClock(t)}`;
  if (days === 1) return `yesterday ${fmtClock(t)}`;
  return fmtDateTime(t);
}

export function fmtAge(seconds) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

// "2026-11-04" (UTC) for a unix time; daily files and history folders use UTC dates
export function utcDate(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export function dateToUnix(s) {
  return Date.parse(s + "T00:00:00Z") / 1000;
}
