// Every fetch of the site goes through this file. Each file is loaded once and kept in memory:
// every request counts against our free-tier quota.
import { buildRows, shardOf } from "./model.js";
import { buildIndex } from "./search.js";
import { setSampleClock, now } from "./clock.js";
import { monthsBetween, daysBetween, dailySeries, rangeSeconds } from "./analysis.js";
import { utcDate } from "./format.js";

// Later this becomes our own data URL (behind the login cookie).
export const DATA_BASE = "sample/out/";
const STRESS_LATEST = "sample/stress/latest.json";
// Oldest month a daily file can exist for; months before it are never requested.
export const FIRST_MONTH = "2026-10";

export const IS_SAMPLE = DATA_BASE.startsWith("sample/");
export const IS_STRESS = (() => {
  try { return new URLSearchParams(location.search).get("data") === "stress"; } catch { return false; }
})();

const cache = new Map();

class NotFound extends Error {}

function getJSON(url, { optional = false } = {}) {
  if (!cache.has(url)) {
    const p = fetch(url, { credentials: "include" }).then((res) => {
      if (res.status === 404) throw new NotFound(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.json();
    });
    cache.set(url, p);
    // Failed loads are forgotten so "Try again" really tries again. A 404 is a real answer, keep it.
    p.catch((e) => { if (!(e instanceof NotFound)) cache.delete(url); });
  }
  const p = cache.get(url);
  return optional ? p.catch((e) => { if (e instanceof NotFound) return null; throw e; }) : p;
}

let market = null;

// latest.json + names.json. Enough for every page except the item chart and the trend views.
export function loadMarket() {
  if (!market) {
    const latestUrl = IS_STRESS ? STRESS_LATEST : DATA_BASE + "latest.json";
    market = Promise.all([getJSON(latestUrl), getJSON(DATA_BASE + "names.json", { optional: true })])
      .then(([latest, names]) => {
        if (IS_SAMPLE) setSampleClock(latest.updated);
        const rows = buildRows(latest, names || {});
        return {
          updated: latest.updated,
          scans24h: latest.scans24h,
          contributors24h: latest.contributors24h,
          lastScanHour: latest.lastScanHour,
          rows,
          named: rows.filter((r) => r.named),
          byId: new Map(rows.map((r) => [r.id, r])),
          names: names || {},
          index: buildIndex(rows),
        };
      });
    market.catch(() => { market = null; });
  }
  return market;
}

// Daily files for a range (one per month, each holds all items). Resolves to a Daily helper.
export async function loadDaily(range) {
  const t = now();
  const from = range.days === Infinity ? -Infinity : t - rangeSeconds(range) - 3 * 86400;
  const months = monthsBetween(from, t, FIRST_MONTH);
  const files = await Promise.all(months.map((m) => getJSON(`${DATA_BASE}daily/${m}.json`, { optional: true })));
  const loaded = files.filter(Boolean);
  const memo = new Map();
  return {
    today: utcDate(t),
    seriesOf(row) {
      const key = row.key || row;
      if (!memo.has(key)) memo.set(key, dailySeries(loaded, key));
      return memo.get(key);
    },
  };
}

// Hourly history for one item key from fromT to now. Files load in parallel; onPart gets
// the points collected so far each time a file arrives, so the chart can draw early.
export async function loadHistory(key, fromT, onPart) {
  const shard = shardOf(key);
  const points = [];
  let failed = 0;
  const days = daysBetween(fromT, now());
  await Promise.all(days.map((day) =>
    getJSON(`${DATA_BASE}history/${day}/${shard}.json`, { optional: true })
      .then((file) => {
        const rec = file && file[key];
        if (!rec) return;
        for (const [hour, v] of Object.entries(rec)) {
          const t = Number(hour);
          if (t < fromT || !Array.isArray(v)) continue;
          points.push({ t, m: v[0], a: v[1], b: v[2], u: v[3], l: v[4] });
        }
        points.sort((x, y) => x.t - y.t);
        onPart && onPart(points.slice());
      })
      .catch(() => { failed++; })));
  if (failed && !points.length) throw new Error("history failed");
  return points;
}
