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

export function unknownName(id) {
  return `Unknown item #${id}`;
}

function entry(key, v) {
  return {
    key, suffix: suffixOf(key),
    min: v.min, p10: v.p10, med: v.med, units: v.units, listings: v.listings, seen: v.seen,
    ch6: v.ch6 ?? null, ch24: v.ch24 ?? null, ladder: v.ladder || "", spark: Array.isArray(v.spark) ? v.spark : null,
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
