import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, findNode } from "../js/categories.js";
import { parseLadder, shardOf, buildRows, parseTsm, addTsm, agreedChange } from "../js/model.js";
import {
  isMoverCandidate, flipDeal, rangeChange, getRange, trendOf, usualRange, monthsBetween, hourProfile, topMovers,
  setTrendFrom, findSignals, vendorDeal, nearVendor, matStats, smallGapVendor,
} from "../js/analysis.js";
import { fmtPct } from "../js/format.js";
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
    return { date: new Date(t * 1000).toISOString().slice(0, 10), t, med: m, p10: m, min: m, units: 100 };
  });
};

test("range change against the daily file", () => {
  const s = series([100, 100, 100, 100, 100, 100, 100, 110, 120, 130]);
  const row = it({ p10: 150, med: 160, ch24: 0.1 });
  assert.equal(rangeChange(row, getRange("24h"), s, "2026-11-04"), 0.1);
  assert.ok(Math.abs(rangeChange(row, getRange("7d"), s, "2026-11-04") - 0.5) < 1e-9);
  assert.equal(rangeChange(row, getRange("30d"), s, "2026-11-04"), null);
  assert.ok(Math.abs(rangeChange(row, getRange("all"), s, "2026-11-04") - 0.5) < 1e-9);
});

test("trend: needs 14 days and a clean fit to call it steady, and never projects", () => {
  const up = series([100, 103, 106, 109, 113, 116, 120, 123, 127, 131, 135, 139, 143, 147]);
  const tr = trendOf(up, 151, "2026-11-04");
  assert.ok(tr.steady && tr.perWeek > 0.15 && tr.r2 > 0.95);
  assert.equal(tr.proj30, undefined);
  const short = trendOf(series([100, 103, 106, 109, 113, 116, 120, 123, 127, 131]), 135, "2026-11-04");
  assert.equal(short.steady, false); // 11 days: history, not a steady trend yet
  const noise = series([100, 130, 90, 125, 95, 120, 100, 128, 92, 110, 95, 125, 90, 120]);
  assert.equal(trendOf(noise, 110, "2026-11-04").steady, false);
  assert.equal(trendOf(series([100, 101]), 102, "2026-11-04"), null);
});

test("usual range = today's price ± the median daily move", () => {
  const s = series([100, 110, 100, 110, 100, 110, 100]);
  const ur = usualRange(s, 110, "2026-11-04");
  assert.ok(Math.abs(ur.swing - 0.1) < 1e-9);
  assert.ok(ur.lo < 110 && ur.hi > 110 && Math.abs(ur.hi - 121) < 1e-6);
  assert.equal(usualRange(series([100, 101, 102]), 103, "2026-11-04"), null);
});

test("launch days are left out of changes and trends", () => {
  const s = series([1000, 800, 600, 500, 400, 120, 100, 100, 100, 100]); // 25 Oct .. 3 Nov
  const row = it({ p10: 100 });
  setTrendFrom("2026-10-30");
  try {
    // "All" compares with 30 Oct (120), not with the launch price of 1000
    assert.ok(Math.abs(rangeChange(row, getRange("all"), s, "2026-11-04") - (100 / 120 - 1)) < 1e-9);
    assert.equal(trendOf(s, 100, "2026-11-04").days, 6);
  } finally { setTrendFrom(null); }
});

test("thin items get no long-range change", () => {
  const s = series([100, 100, 100, 100, 100, 100, 100, 100]);
  assert.equal(rangeChange(it({ p10: 5000, listings: 2 }), getRange("7d"), s, "2026-11-04"), null);
  assert.ok(Math.abs(rangeChange(it({ p10: 150, med: 170, listings: 5 }), getRange("7d"), s, "2026-11-04") - 0.5) < 1e-9);
  // a 1c dump a week ago moved only the market price, not the median: no real move
  assert.equal(rangeChange(it({ p10: 150, med: 100, listings: 5 }), getRange("7d"), s, "2026-11-04"), 0);
});

test("percent display is capped", () => {
  assert.equal(fmtPct(299), ">+999%");
  assert.equal(fmtPct(9.98), "+998%");
  assert.equal(fmtPct(-0.99), "−99%");
});

test("signals and movers measure staleness against the newest scan, not the clock", () => {
  const scan = 1_000_000;
  const row = it({ p10: 200, med: 200, listings: 10, seen: scan - 3600, ch24: 0.5 });
  // the caller passes the newest scan's hour, so hours without scans don't empty the lists
  assert.equal(isMoverCandidate(row, scan), true);
  assert.equal(isMoverCandidate(row, scan + 3 * 3600), false);
  const sigs = findSignals([row], () => [], scan, "2026-11-04");
  assert.ok(sigs.some((x) => x.type === "spike"));
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

test("TSM adds sales to our rows and search-only rows for items we never scanned", () => {
  const latest = { items: { 2589: { min: 23, p10: 24, med: 25, units: 100, listings: 10, seen: 1 } } };
  const names = { 2589: { en: "Linen Cloth", q: 1, cls: 7, sub: 5 }, 934: { en: "Stalvan's Reaper", q: 3, cls: 2, sub: 1 } };
  const rows = buildRows(latest, names);
  const tsm = parseTsm({ realmAt: 50, regionAt: 40, cols: ["mv", "min", "recent", "hist", "sold", "rate", "avg", "regionMv"],
    items: { 2589: [24, 24, 25, 25, 7635.6, 0.796, 30, 24], 934: [50000, 0, 0, 50000, 0, 0, 0, 0], 4306: [0, 0, 0, 0, 287.9, 0.8, 225, 837] } });
  const only = addTsm(rows, tsm, names);
  assert.equal(rows[0].sold, 7635.6);
  assert.equal(rows[0].tsm.rate, 0.796);
  assert.equal(only.length, 1);                       // 4306 has no Horde price: not shown
  assert.equal(only[0].id, "934");
  assert.equal(only[0].p10, 50000);
  assert.equal(only[0].tsmOnly, true);
  assert.equal(only[0].name, "Stalvan's Reaper");
  assert.deepEqual(search(buildIndex(rows.concat(only)), "stalvan").map((r) => r.id), ["934"]);
  assert.equal(parseTsm(null), null);
  assert.deepEqual(addTsm(rows, null, names), []);
});

test("short changes: market price (pc24) wins over the median's, thin items get none", () => {
  const rows = buildRows({ items: {
    "1": it({ listings: 8, ch24: 0.5, pc24: 0.1, ch6: 0.2 }),
    "2": it({ listings: 2, ch24: 299, pc24: 299 }),
  } }, {});
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by["1"].ch24, 0.1);
  assert.equal(by["1"].ch6, 0.2); // no pc6 yet: the median's alone
  assert.equal(by["2"].ch24, null);
});

test("market price and median must agree on a move", () => {
  assert.equal(agreedChange(299, 0.05), 0.05);
  assert.equal(agreedChange(-0.4, -0.1), -0.1);
  assert.equal(agreedChange(2, -0.1), 0);
  assert.equal(agreedChange(null, 0.3), 0.3);
  assert.equal(agreedChange(null, undefined), null);
});

test("items that barely sell stay out of movers", () => {
  const scan = 1_000_000;
  assert.equal(isMoverCandidate(it({ med: 500, listings: 9, seen: scan, sold: 0.2 }), scan), false);
  assert.equal(isMoverCandidate(it({ med: 500, listings: 9, seen: scan, sold: 2 }), scan), false);
  assert.equal(isMoverCandidate(it({ med: 500, listings: 9, seen: scan, sold: 50, q: 0 }), scan), false); // grey
  assert.equal(isMoverCandidate(it({ med: 500, listings: 9, seen: scan, sold: 3 }), scan), true);
  assert.equal(isMoverCandidate(it({ med: 500, listings: 9, seen: scan, sold: null }), scan), true);
});

test("5x jumps are resets: not movers", () => {
  const rows = [it({ id: "a" }), it({ id: "b" }), it({ id: "c" })];
  const ch = { a: 0.3, b: 12, c: -0.9 };
  const mv = topMovers(rows, (r) => ch[r.id]);
  assert.deepEqual(mv.up.map(([r]) => r.id), ["a"]);
  assert.equal(mv.down.length, 0);
});

test("vendor deals: below vendor = free money, near vendor = small max loss", () => {
  const r = it({ sell: 500, ladder: "300*2;450*1;600*5", p10: 300, listings: 8 });
  const d = vendorDeal(r);
  assert.equal(d.units, 3);
  assert.equal(d.profit, 3 * 500 - (600 + 450));
  assert.equal(vendorDeal(it({ sell: 0, ladder: "1*5" })), null);
  assert.ok(Math.abs(nearVendor(it({ sell: 1000, p10: 1150, listings: 5 })).over - 0.15) < 1e-9);
  assert.ok(nearVendor(it({ sell: 25000, p10: 36422, listings: 96 })));   // Maker's Spark, +46%
  assert.equal(nearVendor(it({ sell: 1000, p10: 1600, listings: 5 })), null);
  assert.equal(nearVendor(it({ sell: 1000, p10: 1100, listings: 5, q: 0 })), null); // grey vendor trash
});

test("raid mat stats: lowest since launch, usual price, EU value", () => {
  const s = series([200, 180, 150, 120, 110, 100, 105]);
  const st = matStats(it({ p10: 100, tsm: { regionMv: 200 } }), s, "2026-11-04");
  assert.equal(st.low, 100);
  assert.equal(st.vsEu, -0.5);
  assert.equal(st.cheap, true);
});

test("cheap items near vendor: big %, small coins", () => {
  assert.equal(smallGapVendor(it({ sell: 30, p10: 100, listings: 5 })).risk, 70);
  assert.equal(smallGapVendor(it({ sell: 30, p10: 200, listings: 5 })), null);   // 1s70c loss: too much
  assert.equal(smallGapVendor(it({ sell: 100, p10: 140, listings: 5 })), null);  // within 50%: the other list
});
