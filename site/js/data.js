// Every fetch of the site goes through this file. Each file is loaded once and kept in memory:
// every request counts against our free-tier quota.
import { buildRows, shardOf } from "./model.js";
import { buildIndex } from "./search.js";
import { setSampleClock, now } from "./clock.js";
import { monthsBetween, daysBetween, dailySeries, rangeSeconds } from "./analysis.js";
import { utcDate } from "./format.js";

// Live: our own data route (the site Worker reads the private bucket). Sample data on localhost,
// or anywhere with ?data=sample (?data=stress adds 15,000 extra items to test speed).
const PARAM = (() => {
  try { return new URLSearchParams(location.search).get("data"); } catch { return null; }
})();
const LOCAL = (() => {
  try { return ["localhost", "127.0.0.1", ""].includes(location.hostname); } catch { return true; }
})();
export const IS_STRESS = PARAM === "stress";
export const IS_SAMPLE = IS_STRESS || PARAM === "sample" || (LOCAL && PARAM !== "live");
export const DATA_BASE = IS_SAMPLE ? "sample/out/" : "/data/";
const STRESS_LATEST = "sample/stress/latest.json";
// Oldest month a daily file can exist for; months before it are never requested.
export const FIRST_MONTH = IS_SAMPLE ? "2026-10" : "2026-11";

const cache = new Map();

export class NotFound extends Error {}
// No scan has been processed yet (no latest.json, or an empty one).
export class NoData extends Error {}
// The data is there, but only for signed-in members.
export class Locked extends Error {}

function getJSON(url, { optional = false } = {}) {
  if (!cache.has(url)) {
    const p = fetch(url, { credentials: "include" }).then((res) => {
      if (res.status === 404) throw new NotFound(url);
      if (res.status === 401 || res.status === 403) throw new Locked(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.json();
    });
    cache.set(url, p);
    // Failed loads are forgotten so "Try again" really tries again. A 404 is a real answer, keep it.
    p.catch((e) => { if (!(e instanceof NotFound)) cache.delete(url); });
    // 404 on latest.json just means "no scan yet": try again on the next visit to that page.
    if (url.endsWith("latest.json")) p.catch((e) => { if (e instanceof NotFound) cache.delete(url); });
  }
  const p = cache.get(url);
  return optional ? p.catch((e) => { if (e instanceof NotFound) return null; throw e; }) : p;
}

let market = null;

// latest.json + names.json. Enough for every page except the item chart and the trend views.
export function loadMarket() {
  if (!market) {
    const latestUrl = IS_STRESS ? STRESS_LATEST : DATA_BASE + "latest.json";
    market = Promise.all([
      getJSON(latestUrl).catch((e) => { throw e instanceof NotFound ? new NoData() : e; }),
      getJSON(DATA_BASE + "names.json", { optional: true }),
    ])
      .then(([latest, names]) => {
        if (!latest || !latest.lastScanHour || !latest.items || !Object.keys(latest.items).length) throw new NoData();
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
