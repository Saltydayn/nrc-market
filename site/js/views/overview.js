// Overview: what matters right now, then every market at a glance.
import { html, setHTML, $ } from "../dom.js";
import { now } from "../clock.js";
import { fmtInt, moneyText } from "../format.js";
import { FEATURED, findNode, inNode } from "../categories.js";
import { isMoverCandidate, topMovers, flipDeal, findSignals, getRange, median, SIGNAL_TYPES } from "../analysis.js";
import { watchlist } from "../store.js";
import { money, change, itemIcon, itemName, confidence } from "../ui/bits.js";
import { itemHref } from "../ui/table.js";
import { icon } from "../ui/icons.js";
import { miniList, stackList, dailyFor } from "./common.js";

export async function render(root, { market }) {
  const t = now();
  const rows = market.rows;
  const named = market.named;

  const totalListings = rows.reduce((s, r) => s + r.listings, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  const cands = rows.filter((r) => isMoverCandidate(r, t));
  const mv = topMovers(cands, (r) => r.ch24, 6);
  const flips = rows.map((r) => [r, flipDeal(r)]).filter(([, d]) => d).sort((a, b) => b[1].profit - a[1].profit).slice(0, 6);
  // a single pricey listing isn't trade volume, so ask for a real market
  const valued = rows.filter((r) => r.listings >= 5).sort((a, b) => b.value - a.value).slice(0, 6);

  const wl = watchlist().map((id) => market.byId.get(id)).filter(Boolean);

  const cards = FEATURED.map(findNode).filter(Boolean).map((node) => {
    const items = named.filter((r) => inNode(r.cat, node));
    return { node, items };
  }).filter((c) => c.items.length);

  setHTML(root, html`
    <header class="page-h">
      <div>
        <h1>Auction House</h1>
        <p class="page-sub">EU · PvE · Horde</p>
      </div>
      <dl class="stats-row">
        <div><dt>Items seen</dt><dd>${fmtInt(rows.length)}</dd></div>
        <div><dt>Listings</dt><dd>${fmtInt(totalListings)}</dd></div>
        <div><dt>Listed value</dt><dd>${money(totalValue)}</dd></div>
        <div><dt>Scans in 24 h</dt><dd>${fmtInt(market.scans24h)}</dd></div>
      </dl>
    </header>

    ${wl.length ? html`<section class="wl-strip" aria-labelledby="wl-h">
      <div class="sec-h"><h2 id="wl-h">Watchlist</h2><a href="#/watchlist">Open watchlist</a></div>
      <ul class="wl-cards">${wl.slice(0, 8).map((r) => html`<li><a href="${itemHref(r)}">
        ${itemIcon(r, "medium")}<span class="wl-t">${itemName(r)}<span class="wl-p">${money(r.p10)} ${change(r.ch24)}</span></span></a></li>`)}</ul>
    </section>` : ""}

    <div class="ov-grid">
      <section class="panel">
        <div class="panel-h"><h2><a href="#/movers">Risers</a></h2><span class="panel-note">24 h</span></div>
        ${mv.up.length ? miniList(mv.up.map(([r]) => r), { chg: (r) => r.ch24 }) : html`<p class="panel-empty">No item rose noticeably in the last 24 hours.</p>`}
      </section>
      <section class="panel">
        <div class="panel-h"><h2><a href="#/movers">Fallers</a></h2><span class="panel-note">24 h</span></div>
        ${mv.down.length ? miniList(mv.down.map(([r]) => r), { chg: (r) => r.ch24 }) : html`<p class="panel-empty">No item fell noticeably in the last 24 hours.</p>`}
      </section>
      <section class="panel">
        <div class="panel-h"><h2><a href="#/deals">Deals right now</a></h2><span class="panel-note">profit after AH cut</span></div>
        ${flips.length ? html`<ul class="mini">${flips.map(([r, d]) => html`<li><a href="${itemHref(r)}">
          ${itemIcon(r, "medium")}
          <span class="mini-name">${itemName(r)}<span class="sub">Buy ${fmtInt(d.units)} at ≤ ${moneyText(d.maxPrice)}, resell at ${moneyText(d.resell)}</span></span>
          <span class="val profit">+${money(d.profit)}</span></a></li>`)}</ul>`
          : html`<p class="panel-empty">Nothing is listed far enough below market price right now.</p>`}
      </section>
      <section class="panel">
        <div class="panel-h"><h2>Most listed value</h2><span class="panel-note">supply × market price</span></div>
        ${miniList(valued, { value: (r) => money(r.value), sub: (r) => `${fmtInt(r.units)} listed at ${moneyText(r.p10)}` })}
      </section>
    </div>

    <section class="ov-signals" aria-labelledby="sig-h">
      <div class="sec-h"><h2 id="sig-h">Worth a look</h2><a href="#/insights">All insights</a></div>
      <div class="sig-teaser" id="sig-teaser"><div class="ph-block" style="height:92px"></div></div>
    </section>

    <section aria-labelledby="mk-h">
      <div class="sec-h"><h2 id="mk-h">Markets</h2><span class="muted">Most listed items per category · 24 h change</span></div>
      <div class="cat-grid">${cards.map(({ node, items }) => {
        const top = items.slice().sort((a, b) => b.listings - a.listings).slice(0, 6);
        const avg = median(items.map((r) => r.ch24).filter((v) => v != null));
        return html`<section class="panel cat-card">
          <div class="panel-h"><h2><a href="#/c/${node.path}">${node.label}</a></h2>
            <span class="panel-note">${fmtInt(items.length)} ${items.length === 1 ? "item" : "items"}${avg != null ? html` · median ${change(avg, { arrow: false })}` : ""}</span></div>
          ${stackList(top, { chg: (r) => r.ch24, spark: (r) => r.spark, sub: (r) => `${fmtInt(r.listings)} listings` })}
          ${items.length > top.length ? html`<div class="panel-f"><a href="#/c/${node.path}">All ${fmtInt(items.length)} ${node.label.toLowerCase()}</a></div>` : ""}
        </section>`;
      })}</div>
    </section>
  `);

  // Signals need the daily files; load them after the page is up.
  const range = getRange("14d");
  const daily = await dailyFor(range);
  const box = $("#sig-teaser", root);
  if (!box) return;
  if (!daily) { setHTML(box, html`<p class="panel-empty">Trends are not available right now.</p>`); return; }
  const seen = new Set();
  const sigs = findSignals(rows, (r) => daily.seriesOf(r), t, daily.today)
    .filter((s) => s.type !== "spike" && !seen.has(s.row.id) && seen.add(s.row.id))
    .slice(0, 4);
  setHTML(box, sigs.length ? html`<ul class="sig-cards">${sigs.map((s) => html`<li><a href="${itemHref(s.row)}">
      <span class="sig-type sig-${s.type}">${icon(s.type === "rising" || s.type === "supply-down" || s.type === "high" || s.type === "expensive" ? "up" : "down", { size: 14 })}${SIGNAL_TYPES[s.type]}</span>
      <span class="sig-item">${itemIcon(s.row, "small")}${itemName(s.row)}</span>
      <span class="sig-text">${s.detail}</span>
      ${confidence(s.conf)}
    </a></li>`)}</ul>`
    : html`<p class="panel-empty">No clear signals yet. They show up once we have a few days of scans.</p>`);
}

