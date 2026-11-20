// Turns latest.json + names.json into one row per item (random-suffix variants folded in).
import { classify } from "./categories.js";

export function baseId(key) {
  return String(key).split(":")[0];
}

export function suffixOf(key) {
  const s = String(key).split(":")[1];
  return s == null ? null : Number(s);
}

// History shard: itemID % 64 as two hex digits
export function shardOf(key) {
  return (Number(baseId(key)) % 64).toString(16).padStart(2, "0");
}

// "42*1049;43*914" → [{price: 42, units: 1049}, ...], cheapest first
export function parseLadder(str) {
  if (!str || typeof str !== "string") return [];
  const out = [];
  for (const part of str.split(";")) {
    const [p, u] = part.split("*").map(Number);
    if (Number.isFinite(p) && Number.isFinite(u) && u > 0) out.push({ price: p, units: u });
  }
  return out.sort((a, b) => a.price - b.price);
}

// Below this many listings one seller sets the price, so % changes are left out (shown as "—").
export const MIN_LISTINGS = 5;

// A move counts only as far as the market price (p10) and the median agree: same direction, and the
// smaller of the two. One 1c dump or one 50g troll listing moves only one of them.
export function agreedChange(a, b) {
  const fa = Number.isFinite(a), fb = Number.isFinite(b);
  if (!fa || !fb) return fa ? a : fb ? b : null;
  if (Math.sign(a) !== Math.sign(b)) return 0;
  return Math.abs(a) < Math.abs(b) ? a : b;
}

// 6h/24h change of the market price (pc6/pc24 from the job) checked against the median's (ch6/ch24).
// Thin markets get none: a 1-listing grey item going from 1s to 2g is +19,900% and means nothing.
function shortChange(v, p, m) {
  if ((v.listings ?? 0) < MIN_LISTINGS) return null;
  return agreedChange(v[p], v[m]);
}

export function unknownName(id) {
  return `Unknown item #${id}`;
}

function entry(key, v) {
  return {
    key, suffix: suffixOf(key),
    min: v.min, p10: v.p10, med: v.med, units: v.units, listings: v.listings, seen: v.seen,
    ch6: shortChange(v, "pc6", "ch6"), ch24: shortChange(v, "pc24", "ch24"), ladder: v.ladder || "", spark: Array.isArray(v.spark) ? v.spark : null,
  };
}

export function buildRows(latest, names) {
  const groups = new Map();
  for (const [key, v] of Object.entries(latest.items || {})) {
    if (!v || !Number.isFinite(v.p10)) continue;
    const id = baseId(key);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry(key, v));
  }

  const rows = [];
  for (const [id, entries] of groups) {
    const info = (names && names[id]) || null;
    const named = !!(info && info.en);
    // Show the base item once: price of the cheapest variant, listings and units summed.
    entries.sort((a, b) => a.p10 - b.p10);
    const best = entries[0];
    const many = entries.length > 1 || best.suffix != null;
    const units = many ? entries.reduce((s, e) => s + e.units, 0) : best.units;
    const listings = many ? entries.reduce((s, e) => s + e.listings, 0) : best.listings;
    rows.push({
      ...best,
      id,
      name: named ? info.en : unknownName(id),
      named,
      q: info?.q ?? 1,
      cls: info?.cls ?? null,
      sub: info?.sub ?? null,
      ilvl: info?.ilvl ?? null,
      req: info?.req ?? 0,
      stack: info?.stack ?? null,
      icon: info?.icon || null,
      sell: Number.isFinite(info?.sell) ? info.sell : null,   // vendor sell price per unit (copper), 0 = can't be sold
      cat: named ? classify(info.cls, info.sub) : null,
      units,
      listings,
      min: Math.min(...entries.map((e) => e.min)),
      seen: Math.max(...entries.map((e) => e.seen)),
      value: best.p10 * units,
      variants: many ? entries.slice().sort((a, b) => (a.suffix ?? 0) - (b.suffix ?? 0)) : null,
    });
  }
  return rows;
}

// TSM's Forever files, boiled down by the hourly job (out/tsm.json). We only use what our own scans
// can't give: sales (EU region, both factions, about once a day) and prices for items nobody in the
// guild has scanned (Horde AH, every few hours).
export function parseTsm(file) {
  if (!file || !file.items || !Array.isArray(file.cols)) return null;
  const at = (name) => file.cols.indexOf(name);
  const ix = { mv: at("mv"), min: at("min"), recent: at("recent"), hist: at("hist"), sold: at("sold"),
    rate: at("rate"), avg: at("avg"), regionMv: at("regionMv") };
  const val = (v, k) => (ix[k] >= 0 && Number.isFinite(v[ix[k]]) && v[ix[k]] > 0 ? v[ix[k]] : null);
  const byId = new Map();
  for (const [id, v] of Object.entries(file.items)) {
    if (!Array.isArray(v)) continue;
    byId.set(id, {
      mv: val(v, "mv"), min: val(v, "min"), recent: val(v, "recent"), hist: val(v, "hist"),
      sold: val(v, "sold"), rate: val(v, "rate"), avg: val(v, "avg"), regionMv: val(v, "regionMv"),
    });
  }
  return { realmAt: file.realmAt || null, regionAt: file.regionAt || null, byId };
}

// Sales from TSM go onto our own rows. Returns rows for items only TSM has seen on the Horde AH:
// those are shown in search and on their item page, never in lists, movers or deals.
export function addTsm(rows, tsm, names) {
  if (!tsm) return [];
  const ours = new Set();
  for (const r of rows) {
    ours.add(r.id);
    const t = tsm.byId.get(r.id);
    r.tsm = t || null;
    r.sold = t?.sold ?? null;
  }
  const only = [];
  for (const [id, t] of tsm.byId) {
    if (ours.has(id)) continue;
    const price = t.recent || t.min || t.mv;
    if (!price) continue;
    const info = names?.[id] || null;
    const named = !!(info && info.en);
    only.push({
      id, key: id, suffix: null, tsmOnly: true, tsm: t, sold: t.sold,
      name: named ? info.en : unknownName(id), named,
      q: info?.q ?? 1, cls: info?.cls ?? null, sub: info?.sub ?? null, ilvl: info?.ilvl ?? null,
      req: info?.req ?? 0, stack: info?.stack ?? null, icon: info?.icon || null,
      sell: Number.isFinite(info?.sell) ? info.sell : null,
      cat: named ? classify(info.cls, info.sub) : null,
      p10: price, min: t.min, med: null, units: null, listings: 0, value: null,
      seen: tsm.realmAt, ch6: null, ch24: null, ladder: "", spark: null, variants: null,
    });
  }
  return only;
}
