// Market maths on data that's already loaded. Pure functions, no DOM, no fetching.
import { parseLadder } from "./model.js";
import { dateToUnix, utcDate } from "./format.js";

const DAY = 86400;
const HOUR = 3600;

// Change ranges. "hours" ones come straight from latest.json, "days" ones from the daily files.
export const RANGES = [
  { id: "6h", label: "6h", hours: 6 },
  { id: "24h", label: "24h", hours: 24 },
  { id: "3d", label: "3d", days: 3 },
  { id: "5d", label: "5d", days: 5 },
  { id: "7d", label: "7d", days: 7 },
  { id: "10d", label: "10d", days: 10 },
  { id: "14d", label: "14d", days: 14 },
  { id: "30d", label: "30d", days: 30 },
  { id: "60d", label: "60d", days: 60 },
  { id: "90d", label: "90d", days: 90 },
  { id: "180d", label: "180d", days: 180 },
  { id: "360d", label: "360d", days: 360 },
  { id: "all", label: "All", days: Infinity },
];
export const CHART_RANGES = RANGES.filter((r) => r.id !== "6h");

export function getRange(id, list = RANGES, fallback = "7d") {
  return list.find((r) => r.id === id) || list.find((r) => r.id === fallback);
}

export const needsDaily = (range) => !!range.days;

// Chart: hourly history files up to 30 days, the daily files beyond that
export const chartUsesHourly = (range) => !!range.hours || range.days <= 30;

export function rangeSeconds(range) {
  return range.hours ? range.hours * HOUR : range.days * DAY;
}

// Months (YYYY-MM) whose daily file covers [fromT, toT], never before firstMonth
export function monthsBetween(fromT, toT, firstMonth) {
  const first = firstMonth ? dateToUnix(firstMonth + "-01") : -Infinity;
  const start = new Date(Math.max(fromT, first) * 1000);
  const end = new Date(toT * 1000);
  const out = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    if (++m === 12) { m = 0; y++; }
  }
  return out;
}

// UTC dates of the hourly history folders covering the last `seconds`
export function daysBetween(fromT, toT) {
  const out = [];
  for (let t = Math.floor(fromT / DAY) * DAY; t <= toT; t += DAY) out.push(utcDate(t));
  return out;
}

// Daily entries of one key across several month files, oldest first
export function dailySeries(months, key) {
  const out = [];
  for (const m of months) {
    const rec = m && m[key];
    if (!rec) continue;
    for (const [date, v] of Object.entries(rec)) {
      if (!Array.isArray(v)) continue;
      out.push({ date, t: dateToUnix(date), min: v[0], med: v[1], units: v[2] });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? percentile(v, 0.5) : null;
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Current median vs the daily median ~N days ago. Fraction or null when we don't have that far back.
export function rangeChange(row, range, series, today) {
  if (range.hours === 6) return row.ch6;
  if (range.hours === 24) return row.ch24;
  const past = (series || []).filter((d) => d.date < today && d.med > 0);
  if (!past.length || !row.med) return null;
  let ref;
  if (range.days === Infinity) ref = past[0];
  else {
    const target = dateToUnix(today) - range.days * DAY;
    const slack = Math.max(1, Math.round(range.days * 0.15)) * DAY;
    let best = null;
    for (const d of past) {
      const dist = Math.abs(d.t - target);
      if (dist <= slack && (!best || dist < Math.abs(best.t - target))) best = d;
    }
    ref = best;
  }
  return ref ? row.med / ref.med - 1 : null;
}

// Values for a sparkline: the 24 hourly points for short ranges, daily medians for longer ones.
export function sparkValues(row, range, series, today) {
  if (range.hours) return row.spark || null;
  if (!series || !series.length) return null;
  const from = range.days === Infinity ? -Infinity : dateToUnix(today) - range.days * DAY;
  const pts = series.filter((d) => d.t >= from && d.date < today).map((d) => d.med);
  pts.push(row.med);
  return pts.length >= 2 ? pts : null;
}

// Movers and signals ignore thin or stale markets so noise doesn't win.
export function isMoverCandidate(row, now) {
  return row.listings >= 5 && row.med >= 100 && now - row.seen <= 3 * HOUR;
}

export function topMovers(rows, changeOf, n = 15) {
  const withCh = [];
  for (const r of rows) {
    const c = changeOf(r);
    if (c != null && Number.isFinite(c)) withCh.push([r, c]);
  }
  const up = withCh.filter(([, c]) => c >= 0.005).sort((a, b) => b[1] - a[1]).slice(0, n);
  const down = withCh.filter(([, c]) => c <= -0.005).sort((a, b) => a[1] - b[1]).slice(0, n);
  return { up, down };
}

// Flip deal: listings cheap enough to buy out and relist at market price after the 5 % AH cut.
// Resale is the market price (p10), the cheap end of the market, so it stays conservative.
export const AH_CUT = 0.05;
export function flipDeal(row, { minMargin = 0.15, minProfit = 1000 } = {}) {
  if (row.listings < 3 || !row.p10) return null;
  const resell = row.p10;
  const net = resell * (1 - AH_CUT);
  const steps = parseLadder(row.ladder).filter((s) => s.price * (1 + minMargin) <= net);
  if (!steps.length) return null;
  const units = steps.reduce((s, x) => s + x.units, 0);
  const cost = steps.reduce((s, x) => s + x.units * x.price, 0);
  const profit = Math.round(units * net - cost);
  if (profit < minProfit) return null;
  return { units, cost, maxPrice: steps[steps.length - 1].price, resell, profit, margin: profit / cost };
}

export function linreg(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: my - slope * mx, r2 };
}

// Trend over the last `window` days of daily medians plus today's live median.
// Fitted on log prices, so the slope reads as % per day.
export function trendOf(series, cur, today, { window = 14 } = {}) {
  const todayT = dateToUnix(today);
  const pts = (series || []).filter((d) => d.date < today && d.t >= todayT - window * DAY && d.med > 0);
  if (cur > 0) pts.push({ t: todayT, med: cur });
  if (pts.length < 5) return null;
  const xs = pts.map((d) => (d.t - pts[0].t) / DAY);
  const ys = pts.map((d) => Math.log(d.med));
  const fit = linreg(xs, ys);
  if (!fit) return null;
  const days = pts.length;
  const perWeek = Math.exp(fit.slope * 7) - 1;
  let confidence = "low";
  if (days >= 10 && fit.r2 >= 0.7) confidence = "high";
  else if (days >= 7 && fit.r2 >= 0.5) confidence = "medium";
  return {
    days,
    r2: fit.r2,
    perDay: Math.exp(fit.slope) - 1,
    perWeek,
    proj30: cur * Math.exp(fit.slope * 30),
    steady: fit.r2 >= 0.6 && Math.abs(perWeek) >= 0.05,
    confidence,
  };
}

// How much to trust the numbers for one item. Warnings are shown next to prices and signals.
export function dataQuality(row, series, today) {
  const past = (series || []).filter((d) => d.date < today);
  const meds = past.slice(-14).map((d) => d.med).filter((v) => v > 0);
  let cv = null;
  if (meds.length >= 3) {
    const mean = meds.reduce((s, v) => s + v, 0) / meds.length;
    const sd = Math.sqrt(meds.reduce((s, v) => s + (v - mean) ** 2, 0) / meds.length);
    cv = sd / mean;
  }
  const warnings = [];
  if (row.listings < 5) warnings.push({ id: "thin", text: "Few listings: a single seller can move this price." });
  if (past.length < 5) warnings.push({ id: "young", text: `Only ${past.length} ${past.length === 1 ? "day" : "days"} of history so far.` });
  if (cv != null && cv > 0.2) warnings.push({ id: "volatile", text: "Volatile: the daily price swings a lot." });
  return { days: past.length, cv, warnings };
}

function confidenceOf(q, row) {
  if (q.days >= 10 && row.listings >= 20 && !q.warnings.some((w) => w.id === "volatile")) return "high";
  if (q.days >= 5 && row.listings >= 8) return "medium";
  return "low";
}

// Rule-based signals for the Insights page. Each one says in words why it fired.
export const SIGNAL_TYPES = {
  rising: "Rising steadily",
  falling: "Falling steadily",
  cheap: "Cheaper than usual",
  expensive: "Pricier than usual",
  "supply-down": "Supply drying up",
  "supply-up": "Supply flooding in",
  high: "New 30-day high",
  low: "New 30-day low",
  spike: "Sharp move in 24h",
};

export function findSignals(rows, seriesOf, now, today) {
  const out = [];
  for (const row of rows) {
    if (!isMoverCandidate(row, now)) continue;
    const series = seriesOf(row);
    const past = series.filter((d) => d.date < today && d.med > 0);
    const q = dataQuality(row, series, today);
    const base = { row, warnings: q.warnings, conf: confidenceOf(q, row) };
    const add = (type, score, detail, extra = {}) => out.push({ ...base, type, score, detail, ...extra });

    const tr = trendOf(series, row.med, today);
    if (tr && tr.steady) {
      add(tr.perWeek > 0 ? "rising" : "falling", Math.abs(tr.perWeek) * tr.r2,
        `${tr.perWeek > 0 ? "Up" : "Down"} about ${pctWord(tr.perWeek)} a week over ${tr.days} days, consistently.`,
        { trend: tr, conf: tr.confidence === "high" && base.conf !== "low" ? "high" : tr.confidence });
    }

    const recent = past.slice(-7);
    if (recent.length >= 3) {
      const usual = median(recent.map((d) => d.med));
      const dev = usual ? row.med / usual - 1 : null;
      if (dev != null && dev <= -0.2) add("cheap", -dev, `${pctWord(dev)} below its usual price of the last ${recent.length} days.`, { usual, dev });
      if (dev != null && dev >= 0.3) add("expensive", dev, `${pctWord(dev)} above its usual price of the last ${recent.length} days. A good moment to sell.`, { usual, dev });

      const usualUnits = median(recent.map((d) => d.units));
      if (usualUnits > 0) {
        const su = row.units / usualUnits - 1;
        const priceWord = dev == null || Math.abs(dev) < 0.05 ? "price steady" : `price ${dev > 0 ? "up" : "down"} ${pctWord(dev)}`;
        if (su <= -0.45) add("supply-down", -su, `${pctWord(su)} fewer units listed than usual, ${priceWord}.`, { supply: su, dev });
        if (su >= 0.6) add("supply-up", Math.min(su, 5) / 2, `${pctWord(su)} more units listed than usual, ${priceWord}.`, { supply: su, dev });
      }
    }

    const month = past.slice(-30);
    if (month.length >= 7) {
      const hi = Math.max(...month.map((d) => d.med));
      const lo = Math.min(...month.map((d) => d.med));
      if (row.med > hi * 1.05) add("high", row.med / hi - 1, `Above every daily median of the last ${month.length} days.`);
      if (row.med < lo * 0.95) add("low", 1 - row.med / lo, `Below every daily median of the last ${month.length} days.`);
    }

    if (row.ch24 != null && Math.abs(row.ch24) >= 0.25) {
      add("spike", Math.abs(row.ch24), `${row.ch24 > 0 ? "Up" : "Down"} ${pctWord(row.ch24)} in 24 hours.`, { ch: row.ch24 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function pctWord(f) {
  const p = Math.abs(f * 100);
  return (p >= 100 ? Math.round(p).toLocaleString("en-US") : p >= 10 ? Math.round(p) : p.toFixed(1).replace(/\.0$/, "")) + "%";
}

// Price by hour of day (Berlin). Each point is divided by its own day's median first,
// so a rising week doesn't make evenings look expensive.
export function hourProfile(points, hourOf) {
  const byDay = new Map();
  for (const p of points) {
    if (!(p.a > 0)) continue;
    const d = Math.floor(p.t / DAY);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(p);
  }
  const buckets = Array.from({ length: 24 }, () => ({ r: [], u: [] }));
  for (const pts of byDay.values()) {
    if (pts.length < 6) continue; // a day with a handful of scans says nothing about the hours
    const m = median(pts.map((p) => p.a));
    for (const p of pts) {
      const b = buckets[hourOf(p.t)];
      b.r.push(p.a / m);
      if (Number.isFinite(p.u)) b.u.push(p.u);
    }
  }
  const hours = buckets.map((b, h) => ({
    hour: h, n: b.r.length,
    dev: b.r.length ? median(b.r) - 1 : null,
    units: b.u.length ? median(b.u) : null,
  }));
  const days = [...byDay.values()].filter((p) => p.length >= 6).length;
  return { hours, days };
}

// Category index: per day, the median across items of their change since the first day of the
// window, so cheap and expensive items count the same. Plus total units listed.
export function categoryIndex(rows, seriesOf, fromT, today) {
  const perDay = new Map();
  for (const row of rows) {
    const s = seriesOf(row).filter((d) => d.t >= fromT && d.date < today && d.med > 0);
    if (s.length < 2) continue;
    const ref = s[0].med;
    const pts = [...s, { date: today, t: dateToUnix(today), med: row.med, units: row.units }];
    for (const d of pts) {
      if (!perDay.has(d.t)) perDay.set(d.t, { r: [], u: 0 });
      const e = perDay.get(d.t);
      e.r.push(d.med / ref);
      e.u += d.units || 0;
    }
  }
  return [...perDay.entries()].sort((a, b) => a[0] - b[0])
    .map(([t, e]) => ({ t, a: (median(e.r) - 1) * 100, u: e.u, n: e.r.length }));
}

// Same category, closest price on a log scale
export function similarItems(row, rows, n = 6) {
  if (!row.cat) return [];
  return rows
    .filter((r) => r !== row && r.cat && r.cat.top === row.cat.top && r.cat.sub === row.cat.sub && r.p10 > 0)
    .map((r) => [r, Math.abs(Math.log(r.p10 / Math.max(1, row.p10)))])
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([r]) => r);
}
