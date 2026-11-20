// Insights: rule-based signals on the daily history. Each says why it fired and how sure we are.
import { html, setHTML, $ } from "../dom.js";
import { fmtInt } from "../format.js";
import { findSignals, getRange, SIGNAL_TYPES } from "../analysis.js";
import { money, change, itemIcon, itemName, warnings, confidence, loadingBlock, errorBlock } from "../ui/bits.js";
import { itemHref } from "../ui/table.js";
import { catLabel } from "../categories.js";
import { dailyFor } from "./common.js";

const GROUPS = [
  { types: ["rising"], note: "Consistent climb over the last two weeks" },
  { types: ["falling"], note: "Consistent drop over the last two weeks" },
  { types: ["supply-down"], note: "Fewer units listed than usual: often comes before a price rise" },
  { types: ["supply-up"], note: "Many more units than usual: prices tend to follow down" },
  { types: ["cheap"], note: "Below the usual price of the last 7 days" },
  { types: ["expensive"], note: "Above the usual price: a good moment to sell" },
  { types: ["high", "low"], label: "New 30-day highs & lows", note: "Outside every daily price of the last 30 days" },
  { types: ["spike"], note: "Moved 25% or more in a day" },
];

export async function render(root, { market }) {
  setHTML(root, html`
    <header class="page-h"><div><h1>Insights</h1>
      <p class="page-sub" id="ins-sub">Simple rules run on our scan history. They point at things worth a look, not at sure profits.</p></div></header>
    <div id="ins">${loadingBlock(360)}</div>`);

  const daily = await dailyFor(getRange("30d"));
  const box = $("#ins", root);
  if (!box) return;
  if (!daily) { setHTML(box, errorBlock("The history files didn't load.")); return; }

  const sigs = findSignals(market.rows, (r) => daily.seriesOf(r), market.lastScanHour, daily.today);
  const days = Math.max(0, ...market.named.slice(0, 60).map((r) => daily.seriesOf(r).filter((d) => d.date < daily.today).length));
  $("#ins-sub", root).textContent =
    `Simple rules run on our scan history, ${days} ${days === 1 ? "day" : "days"} so far. They point at things worth a look, not at sure profits. Confidence grows as we collect more data.`;

  setHTML(box, html`<div class="ins-grid">${GROUPS.map((g) => {
    const list = sigs.filter((s) => g.types.includes(s.type)).slice(0, 8);
    const label = g.label || SIGNAL_TYPES[g.types[0]];
    return html`<section class="panel ins-panel">
      <div class="panel-h"><h2>${label}</h2><span class="panel-note">${fmtInt(sigs.filter((s) => g.types.includes(s.type)).length)}</span></div>
      <p class="ins-note">${g.note}</p>
      ${list.length ? html`<ul class="sig-rows">${list.map((s) => html`<li><a href="${itemHref(s.row)}">
        ${itemIcon(s.row, "medium")}
        <span class="sig-body">
          <span class="sig-top">${itemName(s.row)}<span class="val">${money(s.row.p10)}</span></span>
          <span class="sig-text">${s.detail}</span>
          <span class="sig-meta">${s.row.cat ? html`<span class="muted">${catLabel(s.row.cat)}</span>` : ""}${confidence(s.conf)}${s.trend ? html`<span class="per-week">${change(s.trend.perWeek)} <span class="muted">/ week</span></span>` : ""}${warnings(s.warnings, { compact: true })}</span>
        </span></a></li>`)}</ul>`
        : html`<p class="panel-empty">Nothing right now.</p>`}
    </section>`;
  })}</div>
  <p class="note ins-foot">Projections extend the last two weeks in a straight line. With only a few days of data they can be far off; the confidence marker and the warning sign tell you how much to trust each one.</p>`);
}
