import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, findNode } from "../js/categories.js";
import { parseLadder, shardOf, buildRows } from "../js/model.js";
import {
  isMoverCandidate, flipDeal, rangeChange, getRange, trendOf, monthsBetween, hourProfile, topMovers,
} from "../js/analysis.js";
import { normalize, buildIndex, search } from "../js/search.js";

test("category mapping follows the in-game tree", () => {
  assert.equal(classify(7, 9).sub.label, "Herbs");
  assert.equal(classify(7, 5).sub.slug, "cloth");
  assert.equal(classify(0, 3).sub.label, "Flasks");
  assert.equal(classify(1, 0).top.slug, "containers");
  assert.equal(classify(2, 7).top.label, "Weapons");
  assert.equal(classify(12, 0).top.slug, "misc"); // unknown class falls back to misc
  assert.equal(classify(null, null), null);
  assert.equal(findNode("trade-goods/herbs").label, "Herbs");
  assert.equal(findNode("nope"), null);
});

test("ladder parsing", () => {
  assert.deepEqual(parseLadder("43*914;42*1049"), [{ price: 42, units: 1049 }, { price: 43, units: 914 }]);
  assert.deepEqual(parseLadder(""), []);
  assert.deepEqual(parseLadder(undefined), []);
  assert.deepEqual(parseLadder("x*1;5*0;7*2"), [{ price: 7, units: 2 }]);
});

test("shard names", () => {
  assert.equal(shardOf("2589"), "1d");
  assert.equal(shardOf("15216:-12"), shardOf("15216"));
  assert.equal(shardOf("64"), "00");
});

const it = (o) => ({ min: 10, p10: 10, med: 12, units: 10, listings: 5, seen: 0, ...o });

test("suffix variants fold into one row with the cheapest price and summed listings", () => {
  const latest = { items: {
    "15216:-12": it({ p10: 500, min: 480, listings: 2, units: 2 }),
    "15216:-19": it({ p10: 300, min: 300, listings: 1, units: 1 }),
    "2589": it({}),
    "19019": it({}),
  } };
  const names = { 15216: { en: "Rune Sword", q: 2, cls: 2, sub: 7 }, 2589: { en: "Linen Cloth", cls: 7, sub: 5 } };
  const rows = buildRows(latest, names);
  const sword = rows.find((r) => r.id === "15216");
  assert.equal(sword.p10, 300);
  assert.equal(sword.key, "15216:-19");
  assert.equal(sword.listings, 3);
  assert.equal(sword.min, 300);
  assert.equal(sword.variants.length, 2);
  assert.equal(rows.find((r) => r.id === "2589").variants, null);
  const unknown = rows.find((r) => r.id === "19019");
  assert.equal(unknown.named, false);
  assert.equal(unknown.name, "Unknown item #19019");
  assert.equal(unknown.cat, null);
});

test("movers filter: listings, price floor, freshness", () => {
  const now = 100000;
  assert.equal(isMoverCandidate(it({ listings: 5, med: 100, seen: now - 3600 }), now), true);
  assert.equal(isMoverCandidate(it({ listings: 4, med: 100, seen: now }), now), false);
  assert.equal(isMoverCandidate(it({ listings: 9, med: 99, seen: now }), now), false);
  assert.equal(isMoverCandidate(it({ listings: 9, med: 500, seen: now - 4 * 3600 }), now), false);
  const rows = [it({ id: "a", ch24: 0.5 }), it({ id: "b", ch24: -0.2 }), it({ id: "c", ch24: 0.001 }), it({ id: "d", ch24: null })];
  const m = topMovers(rows, (r) => r.ch24);
  assert.deepEqual(m.up.map(([r]) => r.id), ["a"]);
  assert.deepEqual(m.down.map(([r]) => r.id), ["b"]);
});

test("flip deal only when cheap listings beat market price after the AH cut", () => {
  const d = flipDeal(it({ p10: 10000, listings: 20, ladder: "5000*4;9800*10;10000*50" }));
  assert.equal(d.units, 4);
  assert.equal(d.profit, 4 * 9500 - 20000);
  assert.equal(flipDeal(it({ p10: 10000, listings: 20, ladder: "9000*4;10000*50" })), null);
  assert.equal(flipDeal(it({ p10: 10000, listings: 1, ladder: "" })), null);
});

const series = (meds, today = "2026-11-04") => {
  const t0 = Date.parse(today + "T00:00:00Z") / 1000;
  return meds.map((m, i) => {
    const t = t0 - (meds.length - i) * 86400;
    return { date: new Date(t * 1000).toISOString().slice(0, 10), t, med: m, min: m, units: 100 };
  });
};

test("range change against the daily file", () => {
  const s = series([100, 100, 100, 100, 100, 100, 100, 110, 120, 130]);
  const row = it({ med: 150, ch24: 0.1 });
  assert.equal(rangeChange(row, getRange("24h"), s, "2026-11-04"), 0.1);
  assert.ok(Math.abs(rangeChange(row, getRange("7d"), s, "2026-11-04") - 0.5) < 1e-9);
  assert.equal(rangeChange(row, getRange("30d"), s, "2026-11-04"), null);
  assert.ok(Math.abs(rangeChange(row, getRange("all"), s, "2026-11-04") - 0.5) < 1e-9);
});

test("trend: steady rise is detected, noise is not", () => {
  const up = series([100, 103, 106, 109, 113, 116, 120, 123, 127, 131]);
  const tr = trendOf(up, 135, "2026-11-04");
  assert.ok(tr.steady && tr.perWeek > 0.15 && tr.r2 > 0.95);
  assert.ok(tr.proj30 > 135);
  const noise = series([100, 130, 90, 125, 95, 120, 100, 128, 92]);
  assert.equal(trendOf(noise, 110, "2026-11-04").steady, false);
  assert.equal(trendOf(series([100, 101]), 102, "2026-11-04"), null);
});

test("months needed for a range", () => {
  const t = Date.UTC(2026, 10, 4) / 1000;
  assert.deepEqual(monthsBetween(t - 7 * 86400, t, "2026-10"), ["2026-10", "2026-11"]);
  assert.deepEqual(monthsBetween(-Infinity, t, "2026-10"), ["2026-10", "2026-11"]);
  assert.deepEqual(monthsBetween(t - 2 * 86400, t, "2026-10"), ["2026-11"]);
});

test("hour profile normalises by day", () => {
  const pts = [];
  for (let d = 0; d < 3; d++) for (let h = 0; h < 24; h++) {
    pts.push({ t: d * 86400 + h * 3600, a: (100 + d * 50) * (h === 20 ? 1.2 : 1), u: 10 });
  }
  const p = hourProfile(pts, (t) => Math.floor((t % 86400) / 3600));
  assert.equal(p.days, 3);
  assert.ok(Math.abs(p.hours[20].dev - 0.2) < 1e-9);
  assert.equal(p.hours[3].dev, 0);
});

test("search: normalisation, multi-word, ranking", () => {
  assert.equal(normalize("Khadgar's Whisker"), "khadgars whisker");
  assert.equal(normalize("  Flask of the TITANS!"), "flask of the titans");
  const rows = [
    { id: "3358", name: "Khadgar's Whisker", named: true, listings: 5 },
    { id: "13510", name: "Flask of the Titans", named: true, listings: 3 },
    { id: "8846", name: "Gromsblood", named: true, listings: 50 },
    { id: "13468", name: "Black Lotus", named: true, listings: 2 },
    { id: "999", name: "Lotus Petal", named: true, listings: 1 },
    { id: "19019", name: "Unknown item #19019", named: false, listings: 9 },
  ];
  const idx = buildIndex(rows);
  assert.deepEqual(search(idx, "khadgars").map((r) => r.id), ["3358"]);
  assert.deepEqual(search(idx, "titans flask").map((r) => r.id), ["13510"]);
  assert.deepEqual(search(idx, "lotus").map((r) => r.id), ["999", "13468"]); // starts-with first
  assert.deepEqual(search(idx, "19019").map((r) => r.id), ["19019"]);
  assert.deepEqual(search(idx, "unknown"), []);
  assert.deepEqual(search(idx, ""), []);
});
