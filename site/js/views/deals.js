// Deals: listings you can buy out and relist at a profit, and items cheaper than usual.
import { html, setHTML, $ } from "../dom.js";
import { fmtInt, fmtPct, fmtSold, moneyText } from "../format.js";
import { flipDeal, vendorDeal, nearVendor, smallGapVendor, findSignals, getRange, AH_CUT } from "../analysis.js";
import { money, itemIcon, itemName, warnings, confidence } from "../ui/bits.js";
import { itemHref, bindRowClicks, PAGE } from "../ui/table.js";
import { catLabel } from "../categories.js";
import { dailyFor } from "./common.js";

// Mats = trade goods and reagents (class 5, 7, and Forever's reagents under misc 15/1), gear = weapons + armor
const isMat = (r) => r.cls === 5 || r.cls === 7 || (r.cls === 15 && r.sub === 1);
const isGear = (r) => r.cls === 2 || r.cls === 4;
const NEAR_KINDS = [
  { id: "all", label: "All", test: () => true },
  { id: "mats", label: "Mats", test: isMat },
  { id: "gear", label: "Gear", test: isGear },
  { id: "other", label: "Other", test: (r) => !isMat(r) && !isGear(r) },
];

export async function render(root, { market }) {
  const flips = market.rows.map((r) => [r, flipDeal(r)]).filter(([, d]) => d).sort((a, b) => b[1].profit - a[1].profit);
  let limit = PAGE;
  const withSell = market.rows.filter((r) => r.sell != null).length;
  const vend = market.rows.map((r) => [r, vendorDeal(r)]).filter(([, d]) => d).sort((a, b) => b[1].profit - a[1].profit);
  // safest first: smallest gap to the vendor price, busy markets before slow ones
  const nearAll = market.rows.map((r) => [r, nearVendor(r)]).filter(([, d]) => d)
    .sort((a, b) => a[1].over - b[1].over || (b[0].sold ?? 0) - (a[0].sold ?? 0));
  const smallAll = market.rows.map((r) => [r, smallGapVendor(r)]).filter(([, d]) => d)
    .sort((a, b) => a[1].risk - b[1].risk || (b[0].sold ?? 0) - (a[0].sold ?? 0));
  const vendNote = withSell < market.rows.length * 0.8
    ? html`<p class="note">Vendor prices are still being collected (${fmtInt(withSell)} of ${fmtInt(market.rows.length)} items so far), so this list grows over the next day.</p>` : "";

  setHTML(root, html`
    <header class="page-h"><div><h1>Deals</h1>
      <p class="page-sub">Listings priced well below the market. Check the price in game before you buy: someone may have been faster.</p></div></header>

    <section class="panel" aria-labelledby="vend-h">
      <div class="panel-h"><h2 id="vend-h">Below vendor price</h2><span class="panel-note">${fmtInt(vend.length)} right now</span></div>
      <div class="panel-b deals-explain"><p class="note">Listings cheaper than what a vendor pays for them: buy, sell to any vendor, keep the difference.
        No auction house cut, no risk. Someone usually grabs these fast.</p>${vendNote}</div>
      ${vend.length ? html`<table class="tbl deal-tbl"><thead><tr>
          <th scope="col">Item</th><th class="num" scope="col">Buy</th><th class="num" scope="col">Cost</th>
          <th class="num" scope="col">Vendor pays</th><th class="num" scope="col">Profit</th></tr></thead>
        <tbody>${vend.slice(0, 30).map(([r, d]) => html`<tr data-href="${itemHref(r)}">
          <td class="c-item"><a class="item-link" href="${itemHref(r)}" title="${r.name}">${itemIcon(r, "medium")}<span class="item-text">${itemName(r)}<span class="item-sub">${r.cat ? catLabel(r.cat) : "#" + r.id}</span></span></a></td>
          <td class="num c-deal"><span class="units">${fmtInt(d.units)} at ≤ </span>${money(d.maxPrice)}</td>
          <td class="num">${money(d.cost)}</td>
          <td class="num">${money(r.sell)}</td>
          <td class="num c-profit profit">+${money(d.profit)}</td></tr>`)}</tbody></table>`
        : html`<p class="panel-empty">Nothing is listed below its vendor price right now.</p>`}
    </section>

    <section class="panel" aria-labelledby="near-h">
      <div class="panel-h"><h2 id="near-h">Close to vendor price</h2><span class="panel-note">${fmtInt(nearAll.length)} items · within 50%</span></div>
      <div class="panel-b deals-explain"><p class="note">Market price at most 50% above what a vendor pays, closest first. Safe holds: if the price
        goes up you sell on the AH, if not you vendor them and lose at most the gap. "Max loss" is per unit.</p>${vendNote}</div>
      <div id="near"></div>
    </section>

    <section class="panel" aria-labelledby="small-h">
      <div class="panel-h"><h2 id="small-h">Cheap items near vendor</h2><span class="panel-note">${fmtInt(smallAll.length)} items · lose at most 1s each</span></div>
      <div class="panel-b deals-explain"><p class="note">Cheap items where the percentage looks big but the coins don't: vendor 30c, market 1s is +233%,
        yet you lose at most 70c per item if you end up vendoring it. Kept apart from the list above so the percentages don't mislead.</p></div>
      <div id="small"></div>
    </section>

    <section class="panel" aria-labelledby="flip-h">
      <div class="panel-h"><h2 id="flip-h">Buy out and relist</h2><span class="panel-note">${fmtInt(flips.length)} right now</span></div>
      <div class="panel-b deals-explain"><p class="note">Buy every listing in the cheap zone, relist at the market price.
        Profit is after the ${Math.round(AH_CUT * 100)}% auction house cut, without the deposit. Only deals with at least 15% margin and 10 silver profit.
        "Sells per day" is from TSM (all of EU): an item that rarely sells can sit on the AH for days.
        Deals marked "slow" buy more units than the whole EU sells in a day.</p></div>
      <div id="flips"></div>
    </section>

    <section class="panel" aria-labelledby="cheap-h">
      <div class="panel-h"><h2 id="cheap-h">Cheaper than usual</h2><span class="panel-note">vs. the last 7 days</span></div>
      <div id="cheap"><div class="ph-block" style="height:160px;border:0"></div></div>
    </section>
  `);

  const box = $("#flips", root);
  bindRowClicks(root);
  function paintFlips() {
    if (!flips.length) { setHTML(box, html`<p class="panel-empty">Nothing is listed far enough below market price right now.</p>`); return; }
    setHTML(box, html`<table class="tbl deal-tbl"><thead><tr>
        <th scope="col">Item</th><th class="num" scope="col">Buy</th><th class="num" scope="col">Cost</th>
        <th class="num" scope="col">Relist at</th><th class="num" scope="col">Profit</th><th class="num" scope="col">Margin</th></tr></thead>
      <tbody>${flips.slice(0, limit).map(([r, d]) => html`<tr data-href="${itemHref(r)}">
        <td class="c-item"><a class="item-link" href="${itemHref(r)}" title="${r.name}">${itemIcon(r, "medium")}<span class="item-text">${itemName(r)}<span class="item-sub">${r.cat ? catLabel(r.cat) : "#" + r.id} · ${fmtInt(r.listings)} listings${r.sold ? ` · sells ${fmtSold(r.sold)}/day` : ""}</span>${slow(r, d)}</span></a></td>
        <td class="num c-deal"><span class="units">${fmtInt(d.units)} at ≤ </span>${money(d.maxPrice)}</td>
        <td class="num">${money(d.cost)}</td>
        <td class="num c-p10">${money(d.resell)}</td>
        <td class="num c-profit profit">+${money(d.profit)}</td>
        <td class="num"><span class="chg chg-up">${fmtPct(d.margin, { sign: false })}</span></td></tr>`)}</tbody></table>
      ${flips.length > limit ? html`<div class="table-more panel-f"><button class="btn" type="button" data-action="more">Show more</button></div>` : ""}`);
  }
  const lists = { near: { all: nearAll, limit: 50, kind: "all" }, small: { all: smallAll, limit: 50, kind: "all" } };
  function paintVend(id) {
    const st = lists[id];
    const nb = $("#" + id, root);
    const kind = NEAR_KINDS.find((k) => k.id === st.kind);
    const rows = st.all.filter(([r]) => kind.test(r));
    const chips = html`<div class="list-ctl panel-b"><div class="seg" role="group" aria-label="Show">
      ${NEAR_KINDS.map((k) => html`<button type="button" data-kind="${k.id}" data-list="${id}" aria-pressed="${k.id === st.kind}">${k.label}</button>`)}</div></div>`;
    if (!rows.length) { setHTML(nb, html`${chips}<p class="panel-empty">Nothing here right now.</p>`); return; }
    setHTML(nb, html`${chips}<table class="tbl deal-tbl"><thead><tr>
          <th scope="col">Item</th><th class="num" scope="col">Market</th><th class="num" scope="col">Vendor pays</th>
          <th class="num" scope="col">Above vendor</th><th class="num" scope="col">Max loss</th><th class="num" scope="col">Sold/day</th></tr></thead>
        <tbody>${rows.slice(0, st.limit).map(([r, d]) => html`<tr data-href="${itemHref(r)}">
          <td class="c-item"><a class="item-link" href="${itemHref(r)}" title="${r.name}">${itemIcon(r, "medium")}<span class="item-text">${itemName(r)}<span class="item-sub">${r.cat ? catLabel(r.cat) : "#" + r.id} · ${fmtInt(r.units)} listed</span></span></a></td>
          <td class="num c-p10">${money(r.p10)}</td>
          <td class="num">${money(r.sell)}</td>
          <td class="num">${fmtPct(d.over, { sign: false })}</td>
          <td class="num">${money(d.risk)}</td>
          <td class="num">${fmtSold(r.sold)}</td></tr>`)}</tbody></table>
        ${rows.length > st.limit ? html`<div class="table-more panel-f"><button class="btn" type="button" data-more-list="${id}">Show more</button><span class="muted">${fmtInt(st.limit)} of ${fmtInt(rows.length)}</span></div>` : ""}`);
  }
  const paintNear = () => { paintVend("near"); paintVend("small"); };
  paintNear();
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-action=more]")) { limit += PAGE; paintFlips(); }
    const more = e.target.closest("[data-more-list]");
    if (more) { lists[more.dataset.moreList].limit += 50; paintVend(more.dataset.moreList); }
    const nk = e.target.closest("[data-kind]");
    if (nk) { const st = lists[nk.dataset.list]; st.kind = nk.dataset.kind; st.limit = 50; paintVend(nk.dataset.list); }
  });
  paintFlips();

  const daily = await dailyFor(getRange("14d"));
  const cheapBox = $("#cheap", root);
  if (!cheapBox) return;
  if (!daily) { setHTML(cheapBox, html`<p class="panel-empty">Trends are not available right now.</p>`); return; }
  const sigs = findSignals(market.rows, (r) => daily.seriesOf(r), market.lastScanHour, daily.today).filter((s) => s.type === "cheap").slice(0, 20);
  setHTML(cheapBox, sigs.length ? html`<ul class="mini sig-list">${sigs.map((s) => html`<li><a href="${itemHref(s.row)}">
      ${itemIcon(s.row, "medium")}
      <span class="mini-name">${itemName(s.row)}<span class="sub">Usually ${moneyText(s.usual)} · ${s.detail}</span></span>
      <span class="sig-meta">${confidence(s.conf)}${warnings(s.warnings, { compact: true })}</span>
      <span class="val">${money(s.row.p10)}</span></a></li>`)}</ul>`
    : html`<p class="panel-empty">Nothing is trading clearly below its usual price.</p>`);
}

// Buying more than all of EU sells in a day means waiting (and paying deposits again) to sell it all.
function slow(r, d) {
  if (r.sold == null || d.units <= r.sold) return "";
  const days = r.sold > 0 ? Math.ceil(d.units / r.sold) : null;
  return html`<span class="item-sub seen-old">Slow: ${days && days < 100 ? `about ${fmtInt(days)} days of EU sales` : "barely sells"}</span>`;
}
