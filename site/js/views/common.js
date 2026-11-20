// Bits shared by several pages.
import { html } from "../dom.js";
import { rangeChange, sparkValues, RANGES, getRange } from "../analysis.js";
import { loadDaily } from "../data.js";
import { pref, setPref } from "../store.js";
import { money, change, itemIcon, itemName, sparkline } from "../ui/bits.js";
import { itemHref } from "../ui/table.js";
import { catLabel } from "../categories.js";

// Context for tables and lists: change and sparkline for the chosen range, memoised per row.
export function listCtx(range, daily, now) {
  const ch = new Map();
  const sp = new Map();
  const series = (r) => (daily ? daily.seriesOf(r) : null);
  return {
    range, now, daily,
    change(r) {
      if (!ch.has(r)) ch.set(r, range.hours || daily ? rangeChange(r, range, series(r), daily?.today) : null);
      return ch.get(r);
    },
    spark(r) {
      if (!sp.has(r)) sp.set(r, sparkValues(r, range, series(r), daily?.today));
      return sp.get(r);
    },
  };
}

// The range the person picked last, per page kind
export function pickRange(query, kind, fallback = "7d", list = RANGES) {
  const id = query.get("range") || pref("range." + kind, fallback);
  return getRange(id, list, fallback);
}

export function rememberRange(kind, range) {
  setPref("range." + kind, range.id);
}

export function rangeSeg(ranges, current, label = "Change over") {
  return html`<div class="range-ctl"><span class="seg-label">${label}</span><div class="seg" role="group" aria-label="${label}">
    ${ranges.map((r) => html`<button type="button" data-range="${r.id}" aria-pressed="${r.id === current.id}">${r.label}</button>`)}
  </div></div>`;
}

// Loads the daily files a range needs (if any). Never throws: trends just stay empty.
export async function dailyFor(range) {
  if (!range.days) return null;
  try { return await loadDaily(range); } catch (e) { console.warn(e); return null; }
}

// Compact list rows used in overview panels and movers
export function miniList(items, { value = (r) => money(r.p10), chg = null, spark = null, sub = (r) => (r.cat ? catLabel(r.cat) : "#" + r.id) } = {}) {
  return html`<ul class="mini${spark ? " with-spark" : ""}">${items.map((r) => html`<li><a href="${itemHref(r)}">
    ${itemIcon(r, "medium")}
    <span class="mini-name">${itemName(r)}<span class="sub">${sub(r)}</span></span>
    ${spark ? html`<span class="mini-spark">${sparkline(spark(r), { w: 64, h: 22, dir: chg ? chg(r) : null })}</span>` : ""}
    <span class="val">${value(r)}</span>
    ${chg ? html`<span class="chg-col">${change(chg(r))}</span>` : ""}
  </a></li>`)}</ul>`;
}

// Two-line rows for narrow cards: name + price on top, detail + sparkline + change below
export function stackList(items, { value = (r) => money(r.p10), chg, spark, sub }) {
  return html`<ul class="stk">${items.map((r) => html`<li><a href="${itemHref(r)}">
    ${itemIcon(r, "medium")}
    <span class="stk-body">
      <span class="stk-l1">${itemName(r)}<span class="val">${value(r)}</span></span>
      <span class="stk-l2"><span class="sub">${sub(r)}</span>${spark ? sparkline(spark(r), { w: 72, h: 18, dir: chg ? chg(r) : null }) : ""}${chg ? change(chg(r)) : ""}</span>
    </span></a></li>`)}</ul>`;
}

export function crumbs(items) {
  return html`<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map((c, i) =>
    html`<li>${c.href && i < items.length - 1 ? html`<a href="${c.href}">${c.label}</a>` : html`<span aria-current="page">${c.label}</span>`}</li>`)}</ol></nav>`;
}
