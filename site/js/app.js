// Boot, shell and hash router.
import { loadMarket, IS_SAMPLE, IS_STRESS, NoData, Locked } from "./data.js";
import { html, setHTML, $ } from "./dom.js";
import { TREE } from "./categories.js";
import { now } from "./clock.js";
import { fmtClock, fmtInt, fmtAge } from "./format.js";
import { icon } from "./ui/icons.js";
import { errorBlock, loadingBlock, waitingBlock, lockedBlock } from "./ui/bits.js";
import { bindSearch } from "./ui/searchbox.js";
import { watchlist, onWatchChange } from "./store.js";

import * as overview from "./views/overview.js";
import * as category from "./views/category.js";
import * as item from "./views/item.js";
import * as movers from "./views/movers.js";
import * as deals from "./views/deals.js";
import * as insights from "./views/insights.js";
import * as watch from "./views/watchlist.js";
import * as results from "./views/search.js";

export const APP_NAME = "NRC Market";

const NAV = [
  { id: "overview", path: "/", label: "Overview", icon: "home" },
  { id: "movers", path: "/movers", label: "Movers", icon: "movers" },
  { id: "deals", path: "/deals", label: "Deals", icon: "deals" },
  { id: "insights", path: "/insights", label: "Insights", icon: "insights" },
  { id: "watchlist", path: "/watchlist", label: "Watchlist", icon: "star" },
];

const ROUTES = {
  "": overview, c: category, item, movers, deals, insights, watchlist: watch, search: results,
};

const main = $("#main");
let market = null;
let cleanup = null;
let firstRoute = true;

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { path: "/" + parts.join("/"), parts, query: new URLSearchParams(qs || "") };
}

function shell() {
  $(".brand-name").textContent = APP_NAME;
  document.title = APP_NAME;
  if (IS_SAMPLE) {
    $(".sample-badge").hidden = false;
    $(".sample-badge").textContent = IS_STRESS ? "Sample data · stress" : "Sample data";
    $(".foot-sample").hidden = false;
  }
  $(".search-ico").innerHTML = String(icon("search", { size: 16 }));
  renderSide();
  setHTML($(".tabs"), html`${NAV.map((n) => html`<a href="#${n.path}" data-nav="${n.id}">${icon(n.icon, { size: 20 })}<span>${n.label}</span></a>`)}`);
  onWatchChange(() => renderSide());
}

function counts() {
  const c = new Map();
  if (!market) return c;
  for (const r of market.named) {
    if (!r.cat) continue;
    c.set(r.cat.top.slug, (c.get(r.cat.top.slug) || 0) + 1);
    if (r.cat.sub) {
      const k = r.cat.top.slug + "/" + r.cat.sub.slug;
      c.set(k, (c.get(k) || 0) + 1);
    }
  }
  return c;
}

function renderSide() {
  const { parts } = parseHash();
  const activeTop = parts[0] === "c" ? parts[1] : null;
  const activeSub = parts[0] === "c" && parts[2] ? `${parts[1]}/${parts[2]}` : null;
  const c = counts();
  const wl = watchlist().length;
  const nav = NAV.map((n) => html`<a class="side-link" href="#${n.path}" data-nav="${n.id}">
    ${icon(n.icon, { size: 18 })}<span>${n.label}</span>${n.id === "watchlist" && wl ? html`<span class="count">${wl}</span>` : ""}</a>`);
  const tree = TREE.filter((t) => !market || c.get(t.slug)).map((t) => {
    const open = t.slug === activeTop || (t.open && !activeTop);
    const subs = open ? t.subs.filter((s) => !market || c.get(`${t.slug}/${s.slug}`)) : [];
    return html`<li>
      <a class="tree-top${t.slug === activeTop && !activeSub ? " active" : ""}" href="#/c/${t.slug}" ${t.slug === activeTop && !activeSub ? html`aria-current="page"` : ""}>
        ${icon(open ? "chevronDown" : "chevron", { size: 14, cls: "tree-chev" })}<span>${t.label}</span><span class="count">${market ? fmtInt(c.get(t.slug) || 0) : ""}</span></a>
      ${subs.length ? html`<ul>${subs.map((s) => {
        const p = `${t.slug}/${s.slug}`;
        return html`<li><a class="tree-sub${p === activeSub ? " active" : ""}" href="#/c/${p}" ${p === activeSub ? html`aria-current="page"` : ""}><span>${s.label}</span><span class="count">${market ? fmtInt(c.get(p) || 0) : ""}</span></a></li>`;
      })}</ul>` : ""}
    </li>`;
  });
  setHTML($(".side"), html`<div class="side-nav">${nav}</div>
    <h2 class="side-h">Auction House</h2>
    <ul class="tree">${tree}</ul>`);
  markNav();
}

function markNav() {
  const { parts } = parseHash();
  const id = parts[0] || "overview";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === id;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function setFresh(text) {
  const el = $(".fresh");
  el.className = "fresh";
  setHTML(el, html`<span>${text}</span>`);
}

function freshness() {
  if (!market) return;
  const t = now();
  const age = t - market.lastScanHour - 3600; // a scan "in hour X" can be up to the end of that hour
  const base = `Updated ${fmtClock(market.updated)} · ${fmtInt(market.scans24h)} scans in 24 h · ${fmtInt(market.contributors24h)} scanners`;
  const el = $(".fresh");
  el.className = "fresh";
  if (age > 12 * 3600) {
    el.classList.add("fresh-old");
    setHTML(el, html`${icon("warn", { size: 14 })}<span>Last scan ${fmtAge(age)} ago. Prices are probably out of date.</span>`);
  } else if (age > 3 * 3600) {
    el.classList.add("fresh-stale");
    setHTML(el, html`<span>${base}</span><span class="fresh-warn">Last scan ${fmtAge(age)} ago, prices may be out of date</span>`);
  } else {
    setHTML(el, html`<span>${base}</span>`);
  }
}

async function route() {
  const r = parseHash();
  const view = ROUTES[r.parts[0] || ""];
  if (cleanup) { try { cleanup(); } catch { /* view already gone */ } cleanup = null; }
  renderSide();
  if (!view) {
    setHTML(main, html`<div class="state-msg"><h1>Page not found</h1><p><a href="#/">Back to the overview</a></p></div>`);
    return;
  }
  if (!market) {
    setHTML(main, loadingBlock(420));
    try {
      market = await loadMarket();
    } catch (e) {
      if (e instanceof NoData) {
        setHTML(main, waitingBlock());
        setFresh("Waiting for the first scan");
      } else if (e instanceof Locked) {
        setHTML(main, lockedBlock());
        setFresh("Members only");
      } else {
        console.warn(e);
        setHTML(main, errorBlock());
      }
      return;
    }
    renderSide();
    freshness();
    bindSearch($("#q"), market);
  }
  if (!firstRoute) window.scrollTo(0, 0);
  main.classList.remove("enter");
  void main.offsetWidth;
  main.classList.add("enter");
  cleanup = await view.render(main, { market, parts: r.parts.slice(1), query: r.query, path: r.path });
  if (!firstRoute) {
    const h = main.querySelector("h1");
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  firstRoute = false;
}

main.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=retry]")) route();
});
// A failed icon just disappears; the placeholder behind it stays.
document.addEventListener("error", (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains("ico-img")) e.target.remove();
}, true);
window.addEventListener("hashchange", route);
setInterval(freshness, 60000);
shell();
route();

