// Re-runs the forecast backtest from hq/specs/2026-11-12-market-predictions.md on daily files.
// Usage: node site/tools/backtest.mjs daily-2026-11.json [daily-2026-12.json ...] [--from 2026-11-08] [--min-units 5]
// Download the files from the site (data/daily/<YYYY-MM>.json, signed in) first.
// Prints the median error of each method 1 and 3 days ahead, and how often the next day's price
// landed inside the site's "usual range". Today's unfinished day is left out.
import { readFileSync } from "node:fs";

const TODAY = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const FROM = opt("--from", "2026-11-08");
const MIN_UNITS = Number(opt("--min-units", 5));
const files = args.map((p) => JSON.parse(readFileSync(p, "utf8")));
console.log(JSON.stringify(backtest(files, { from: FROM, minUnits: MIN_UNITS }), null, 2));

export function backtest(files, { from = null, minUnits = 5 } = {}) {
  // per item: [[date, p10]] oldest first, launch days and thin days left out
  const items = new Map();
  for (const f of files) {
    for (const [key, days] of Object.entries(f || {})) {
      for (const [date, v] of Object.entries(days)) {
        if (!Array.isArray(v) || (from && date < from) || date >= TODAY) continue;
        const p = v[3] ?? v[1];
        if (!(p > 0) || (v[2] ?? 0) < minUnits) continue;
        if (!items.has(key)) items.set(key, []);
        items.get(key).push([date, p]);
      }
    }
  }
  for (const s of items.values()) s.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dates = [...new Set([...items.values()].flatMap((s) => s.map((x) => x[0])))].sort();

  // market-wide drift per day: median log change of all items from the day before
  const drift = new Map();
  for (let i = 1; i < dates.length; i++) {
    const ch = [];
    for (const s of items.values()) {
      const a = s.find((x) => x[0] === dates[i - 1]), b = s.find((x) => x[0] === dates[i]);
      if (a && b) ch.push(Math.log(b[1] / a[1]));
    }
    drift.set(dates[i], med(ch) ?? 0);
  }

  const methods = {
    stays: (h) => h.at(-1)[1],
    marketDriftHalved: (h, ahead) => {
      const d = drift.get(h.at(-1)[0]) ?? 0;
      let sum = 0;
      for (let k = 0; k < ahead; k++) sum += d * 0.5 ** k;
      return h.at(-1)[1] * Math.exp(sum);
    },
    slope3Damped: (h, ahead) => {
      if (h.length < 4) return null;
      const sl = Math.log(h.at(-1)[1] / h.at(-4)[1]) / 3;
      return h.at(-1)[1] * Math.exp(sl * 0.3 * ahead);
    },
    theilSen14: (h, ahead) => {
      const w = h.slice(-14);
      if (w.length < 5) return null;
      const sl = [];
      for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
        sl.push((Math.log(w[j][1]) - Math.log(w[i][1])) / (dayNo(w[j][0]) - dayNo(w[i][0])));
      }
      return h.at(-1)[1] * Math.exp(med(sl) * ahead);
    },
    logLinear14: (h, ahead) => {
      const w = h.slice(-14);
      if (w.length < 5) return null;
      const xs = w.map((x) => dayNo(x[0])), ys = w.map((x) => Math.log(x[1]));
      const mx = avg(xs), my = avg(ys);
      let sxx = 0, sxy = 0;
      for (let i = 0; i < xs.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
      if (!sxx) return null;
      const sl = sxy / sxx;
      return Math.exp(my + sl * (dayNo(h.at(-1)[0]) + ahead - mx));
    },
  };

  const err = {};
  for (const k of Object.keys(methods)) err[k] = { 1: [], 3: [] };
  let inRange = 0, ranged = 0;
  for (const s of items.values()) {
    for (let i = 4; i < s.length; i++) {
      const hist = s.slice(0, i + 1);
      for (const ahead of [1, 3]) {
        const target = s.find((x) => dayNo(x[0]) === dayNo(s[i][0]) + ahead);
        if (!target) continue;
        // compare all methods on the same cases only
        const preds = Object.entries(methods).map(([k, f]) => [k, f(hist, ahead)]);
        if (preds.some(([, p]) => !(p > 0))) continue;
        for (const [k, p] of preds) err[k][ahead].push(Math.abs(p / target[1] - 1));
      }
      // usual range (what the site shows): today ± the 75th percentile daily move of the last 14 days
      const next = s.find((x) => dayNo(x[0]) === dayNo(s[i][0]) + 1);
      const w = hist.slice(-15);
      if (next && w.length >= 6) {
        const moves = [];
        for (let j = 1; j < w.length; j++) moves.push(Math.abs(Math.log(w[j][1] / w[j - 1][1])));
        const srt = moves.sort((a, b) => a - b);
        const m = srt[Math.round((srt.length - 1) * 0.75)], p = hist.at(-1)[1];
        ranged++;
        if (next[1] >= p * Math.exp(-m) && next[1] <= p * Math.exp(m)) inRange++;
      }
    }
  }
  const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10 + "%");
  return {
    items: items.size,
    days: dates.length ? `${dates[0]} .. ${dates.at(-1)}` : null,
    medianError: Object.fromEntries(Object.entries(err).map(([k, v]) => [k, { "1 day": pct(med(v[1])), "3 days": pct(med(v[3])), cases: v[1].length }])),
    usualRange: { nextDayInside: pct(ranged ? inRange / ranged : null), cases: ranged },
  };
}

function dayNo(date) { return Date.parse(date + "T00:00:00Z") / 86400000; }
function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function med(a) {
  if (!a.length) return null;
  const v = a.slice().sort((x, y) => x - y), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
