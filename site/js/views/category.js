// Category: the full sortable table, a category-wide trend chart, sub-category chips.
import { html, setHTML, $, setQuery } from "../dom.js";
import { now } from "../clock.js";
import { fmtInt, fmtPct, fmtDay, fmtCompact } from "../format.js";
import { findNode, inNode } from "../categories.js";
import { RANGES, categoryIndex } from "../analysis.js";
import { normalize } from "../search.js";
import { money } from "../ui/bits.js";
import { renderTable, sortRows, bindRowClicks, DEFAULT_COLS, PAGE, COLUMNS } from "../ui/table.js";
import { createChart } from "../ui/chart.js";
import { listCtx, pickRange, rememberRange, rangeSeg, dailyFor, crumbs } from "./common.js";

export async function render(root, { market, parts, query }) {
  const node = findNode(parts.join("/"));
  if (!node) {
    setHTML(root, html`<div class="state-msg"><h1>Unknown category</h1><p><a href="#/">Back to the overview</a></p></div>`);
    return;
  }
  const path = "/c/" + node.path;
  const all = market.named.filter((r) => inNode(r.cat, node));
  const state = {
    sort: COLUMNS[query.get("sort")] ? query.get("sort") : "listings",
    dir: query.get("dir") === "asc" ? "asc" : "desc",
    q: query.get("q") || "",
    range: pickRange(query, "list", "7d"),
    limit: PAGE,
  };
  let daily = null;
  let ctx = listCtx(state.range, null, now());

  const listings = all.reduce((s, r) => s + r.listings, 0);
  const value = all.reduce((s, r) => s + r.value, 0);
  const subs = node.sub ? [] : node.top.subs.filter((s) => all.some((r) => r.cat.sub === s));

  setHTML(root, html`
    ${crumbs([{ label: "Auction House", href: "#/" }, { label: node.top.label, href: `#/c/${node.top.slug}` }, ...(node.sub ? [{ label: node.sub.label }] : [])])}
    <header class="page-h">
      <div><h1>${node.label}</h1>
        <p class="page-sub">${fmtInt(all.length)} ${all.length === 1 ? "item" : "items"} · ${fmtInt(listings)} listings · ${money(value)} listed</p></div>
    </header>
    ${subs.length ? html`<div class="chips sub-chips">${subs.map((s) => html`<a class="chip chip-link" href="#/c/${node.top.slug}/${s.slug}">${s.label}</a>`)}</div>` : ""}
    <section class="panel cat-trend">
      <div class="panel-h"><h2>Category trend</h2><span class="panel-note" id="ct-note"></span></div>
      <div class="panel-b"><div id="ct-chart"></div>
        <div class="legend"><span><i class="lg-a"></i>Median price change since the start of the range</span><span><i class="lg-v"></i>Units listed</span></div></div>
    </section>
    <div class="list-ctl">
      <input class="field" type="search" id="cat-filter" placeholder="Filter ${node.label.toLowerCase()}" value="${state.q}" aria-label="Filter items in this category">
      ${rangeSeg(RANGES, state.range)}
      <label class="sort-phone"><span class="visually-hidden">Sort by</span>
        <select class="field" id="sort-phone">${["listings", "p10", "units", "sold", "change", "item"].map((id) =>
          html`<option value="${id}" ${state.sort === id ? "selected" : ""}>Sort: ${id === "change" ? "Change" : typeof COLUMNS[id].label === "string" ? COLUMNS[id].label : id}</option>`)}</select></label>
    </div>
    <div id="cat-table"></div>
  `);

  const tableBox = $("#cat-table", root);
  bindRowClicks(tableBox);

  function filtered() {
    const words = normalize(state.q).split(" ").filter(Boolean);
    const list = words.length ? all.filter((r) => { const n = normalize(r.name); return words.every((w) => n.includes(w)); }) : all;
    return sortRows(list, state.sort, state.dir, ctx);
  }

  function paint() {
    const rows = filtered();
    if (!rows.length) {
      setHTML(tableBox, html`<div class="table-wrap"><p class="panel-empty">No results for “${state.q}”.</p></div>`);
      return;
    }
    setHTML(tableBox, renderTable(rows, DEFAULT_COLS, { ...ctx, sort: state.sort, dir: state.dir, limit: state.limit }));
  }

  function sync() {
    setQuery(path, { sort: state.sort !== "listings" ? state.sort : null, dir: state.dir !== "desc" ? state.dir : null, q: state.q || null, range: state.range.id });
  }

  let chart = null;
  let token = 0;
  async function loadTrend() {
    const my = ++token;
    const r = state.range.hours ? RANGES.find((x) => x.id === "7d") : state.range;
    const d = await dailyFor(r);
    if (my !== token) return;
    if (!state.range.hours) { daily = d; ctx = listCtx(state.range, d, now()); paint(); }
    const box = $("#ct-chart", root);
    if (!box) return;
    const t = now();
    const from = r.days === Infinity ? -Infinity : t - r.days * 86400 - 86400;
    const pts = d ? categoryIndex(all, (x) => d.seriesOf(x), from, d.today) : [];
    $("#ct-note", root).textContent = pts.length
      ? `${state.range.hours ? "Last 7 days" : r.days === Infinity ? "All history" : `Last ${r.label}`} · since ${fmtDay(pts[0].t)}`
      : "";
    if (!chart) {
      chart = createChart(box, {
        height: 150, volHeight: 40, step: 86400, zeroLine: true, floorZero: false,
        lines: [{ key: "a", cls: "l-a" }],
        yFmt: (v) => fmtPct(v / 100),
        volFmt: (n) => `${fmtCompact(n)} units`,
        emptyText: "Not enough history for a trend yet.",
        tip: (p) => `<div class="t">${fmtDay(p.t, { weekday: true })}</div><dl><dt>Median change</dt><dd>${fmtPct(p.a / 100)}</dd><dt>Units listed</dt><dd>${fmtInt(p.u)}</dd><dt>Items</dt><dd>${fmtInt(p.n)}</dd></dl>`,
      });
      box.setAttribute("aria-label", `Price trend chart for ${node.label}`);
    }
    chart.update(pts);
  }

  root.addEventListener("click", (e) => {
    const s = e.target.closest("[data-sort]");
    if (s) {
      const id = s.dataset.sort;
      if (state.sort === id) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.sort = id; state.dir = COLUMNS[id].firstDir || "desc"; }
      sync(); paint();
      $(`[data-sort="${id}"]`, root)?.focus();
      return;
    }
    const rb = e.target.closest("[data-range]");
    if (rb) {
      state.range = RANGES.find((r) => r.id === rb.dataset.range);
      rememberRange("list", state.range);
      root.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === rb)));
      ctx = listCtx(state.range, state.range.hours ? null : daily, now());
      sync(); paint(); loadTrend();
      return;
    }
    if (e.target.closest("[data-action=more]")) { state.limit += PAGE; paint(); }
  });
  $("#cat-filter", root).addEventListener("input", (e) => { state.q = e.target.value; state.limit = PAGE; sync(); paint(); });
  $("#sort-phone", root).addEventListener("change", (e) => {
    state.sort = e.target.value; state.dir = COLUMNS[state.sort].firstDir || "desc"; sync(); paint();
  });

  paint();
  loadTrend();
  return () => chart && chart.destroy();
}

