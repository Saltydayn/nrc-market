// Deals: listings you can buy out and relist at a profit, and items cheaper than usual.
import { html, setHTML, $ } from "../dom.js";
import { now } from "../clock.js";
import { fmtInt, fmtPct, moneyText } from "../format.js";
import { flipDeal, findSignals, getRange, AH_CUT } from "../analysis.js";
import { money, itemIcon, itemName, warnings, confidence } from "../ui/bits.js";
import { itemHref, bindRowClicks, PAGE } from "../ui/table.js";
import { catLabel } from "../categories.js";
import { dailyFor } from "./common.js";

export async function render(root, { market }) {
  const flips = market.rows.map((r) => [r, flipDeal(r)]).filter(([, d]) => d).sort((a, b) => b[1].profit - a[1].profit);
  let limit = PAGE;

  setHTML(root, html`
    <header class="page-h"><div><h1>Deals</h1>
      <p class="page-sub">Listings priced well below the market. Check the price in game before you buy: someone may have been faster.</p></div></header>

    <section class="panel" aria-labelledby="flip-h">
      <div class="panel-h"><h2 id="flip-h">Buy out and relist</h2><span class="panel-note">${fmtInt(flips.length)} right now</span></div>
      <div class="panel-b deals-explain"><p class="note">Buy every listing in the cheap zone, relist at the market price.
        Profit is after the ${Math.round(AH_CUT * 100)}% auction house cut, without the deposit. Only deals with at least 15% margin and 10 silver profit.</p></div>
      <div id="flips"></div>
    </section>

    <section class="panel" aria-labelledby="cheap-h">
      <div class="panel-h"><h2 id="cheap-h">Cheaper than usual</h2><span class="panel-note">vs. the last 7 days</span></div>
      <div id="cheap"><div class="ph-block" style="height:160px;border:0"></div></div>
    </section>
  `);

  const box = $("#flips", root);
  bindRowClicks(box);
  function paintFlips() {
    if (!flips.length) { setHTML(box, html`<p class="panel-empty">Nothing is listed far enough below market price right now.</p>`); return; }
    setHTML(box, html`<table class="tbl deal-tbl"><thead><tr>
        <th scope="col">Item</th><th class="num" scope="col">Buy</th><th class="num" scope="col">Cost</th>
        <th class="num" scope="col">Relist at</th><th class="num" scope="col">Profit</th><th class="num" scope="col">Margin</th></tr></thead>
      <tbody>${flips.slice(0, limit).map(([r, d]) => html`<tr data-href="${itemHref(r)}">
        <td class="c-item"><a class="item-link" href="${itemHref(r)}" title="${r.name}">${itemIcon(r, "medium")}<span class="item-text">${itemName(r)}<span class="item-sub">${r.cat ? catLabel(r.cat) : "#" + r.id} · ${fmtInt(r.listings)} listings</span></span></a></td>
        <td class="num c-deal"><span class="units">${fmtInt(d.units)} at ≤ </span>${money(d.maxPrice)}</td>
        <td class="num">${money(d.cost)}</td>
        <td class="num c-p10">${money(d.resell)}</td>
        <td class="num c-profit profit">+${money(d.profit)}</td>
        <td class="num"><span class="chg chg-up">${fmtPct(d.margin, { sign: false })}</span></td></tr>`)}</tbody></table>
      ${flips.length > limit ? html`<div class="table-more panel-f"><button class="btn" type="button" data-action="more">Show more</button></div>` : ""}`);
  }
  root.addEventListener("click", (e) => { if (e.target.closest("[data-action=more]")) { limit += PAGE; paintFlips(); } });
  paintFlips();

  const daily = await dailyFor(getRange("14d"));
  const cheapBox = $("#cheap", root);
  if (!cheapBox) return;
  if (!daily) { setHTML(cheapBox, html`<p class="panel-empty">Trends are not available right now.</p>`); return; }
  const sigs = findSignals(market.rows, (r) => daily.seriesOf(r), now(), daily.today).filter((s) => s.type === "cheap").slice(0, 20);
  setHTML(cheapBox, sigs.length ? html`<ul class="mini sig-list">${sigs.map((s) => html`<li><a href="${itemHref(s.row)}">
      ${itemIcon(s.row, "medium")}
      <span class="mini-name">${itemName(s.row)}<span class="sub">Usually ${moneyText(s.usual)} · ${s.detail}</span></span>
      <span class="sig-meta">${confidence(s.conf)}${warnings(s.warnings, { compact: true })}</span>
      <span class="val">${money(s.row.med)}</span></a></li>`)}</ul>`
    : html`<p class="panel-empty">Nothing is trading clearly below its usual price.</p>`);
}
