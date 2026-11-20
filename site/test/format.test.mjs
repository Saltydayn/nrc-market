import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyText, moneyLabel, moneyGame, fmtPct, fmtInt, relTime, fmtClock, utcDate, fmtCompact } from "../js/format.js";

test("money: drops leading and trailing zero parts", () => {
  assert.equal(moneyText(1), "1c");
  assert.equal(moneyText(99), "99c");
  assert.equal(moneyText(100), "1s");
  assert.equal(moneyText(420), "4s 20c");
  assert.equal(moneyText(10001), "1g 0s 1c");
  assert.equal(moneyText(520300), "52g 3s");
  assert.equal(moneyText(0), "0c");
});

test("money: big amounts drop copper above 100g and silver above 10,000g", () => {
  assert.equal(moneyText(12340000), "1,234g");
  assert.equal(moneyText(12345678), "1,234g 56s");
  assert.equal(moneyText(9999990000), "999,999g");
  assert.equal(moneyText(9999999999), "999,999g");
  assert.equal(moneyText(1000005), "100g");
});

test("money: accessible label and game format", () => {
  assert.equal(moneyLabel(520300), "52 gold 3 silver");
  assert.equal(moneyLabel(5), "5 copper");
  assert.equal(moneyGame(520300), "52g 3s 0c");
  assert.equal(moneyGame(1), "0g 0s 1c");
});

test("percent: sign, real minus, small changes neutral", () => {
  assert.equal(fmtPct(0.125), "+12.5%");
  assert.equal(fmtPct(-0.08), "−8%");
  assert.equal(fmtPct(0.004), "±0%");
  assert.equal(fmtPct(-0.0049), "±0%");
  assert.equal(fmtPct(2.4), "+240%");
  assert.equal(fmtPct(null), "—");
});

test("numbers", () => {
  assert.equal(fmtInt(4961), "4,961");
  assert.equal(fmtInt(-1200), "−1,200");
  assert.equal(fmtCompact(12400), "12.4k");
  assert.equal(fmtCompact(2500000), "2.5M");
});

test("relative times in Berlin time", () => {
  const now = Date.UTC(2026, 10, 4, 19, 10) / 1000; // 20:10 Berlin
  assert.equal(relTime(now - 30, now), "just now");
  assert.equal(relTime(now - 23 * 60, now), "23 min ago");
  assert.equal(relTime(now - 2 * 3600, now), "2 h ago");
  assert.equal(relTime(now - 8 * 3600, now), "today 12:10");
  assert.equal(relTime(Date.UTC(2026, 10, 3, 17, 0) / 1000, now), "yesterday 18:00");
  assert.equal(relTime(Date.UTC(2026, 10, 2, 13, 0) / 1000, now), "2 Nov, 14:00");
  assert.equal(fmtClock(now), "20:10");
  assert.equal(utcDate(now), "2026-11-04");
});
