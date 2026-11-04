// The item table used by category, search and watchlist pages.
// Desktop: a real table. Phone: each row becomes a two-line list item (CSS only).
import { html, raw } from "../dom.js";
import { fmtInt, relTime } from "../format.js";
import { catLabel } from "../categories.js";
import { money, change, itemIcon, itemName, sparkline } from "./bits.js";
import { icon } from "./icons.js";

export const PAGE = 100;

export function itemHref(row, key) {
  return "#/item/" + encodeURIComponent(key || row.id);
}

function itemCell(row, ctx) {
  const sub = [];
  if (ctx.showCat && row.cat) sub.push(catLabel(row.cat));
  if (row.variants) sub.push(`${row.variants.length} variants`);
  if (!row.named) sub.push("No name yet");
  return html`<a class="item-link" href="${itemHref(row)}" title="${row.name}">
    ${itemIcon(row, "medium")}
    <span class="item-text">${itemName(row)}${sub.length ? html`<span class="item-sub">${sub.join(" · ")}</span>` : ""}</span>
  </a>`;
}

// Min → median as a short bar; tells at a glance how wide the market is
function spreadBar(row) {
  if (!(row.med > 0) || !(row.min > 0)) return "";
  const ratio = row.min / row.med;
  const w = Math.max(4, Math.min(100, (1 - ratio) * 200));
  return raw(`<span class="spread" title="Cheapest listing is ${Math.round((1 - ratio) * 100)}% below the median"><i style="width:${w.toFixed(0)}%"></i></span>`);
}

export const COLUMNS = {
  item: { label: "Item", sort: (r) => r.name.toLowerCase(), firstDir: "asc", render: itemCell, cls: "c-item" },
  p10: { label: "Market", num: true, sort: (r) => r.p10, render: (r) => money(r.p10), cls: "c-p10",
    title: "Market price: what the cheapest 10% of all listed units cost. Ignores single odd listings." },
  min: { label: "Min", num: true, sort: (r) => r.min, render: (r) => money(r.min), cls: "c-min", title: "Cheapest listing right now" },
  med: { label: "Median", num: true, sort: (r) => r.med, render: (r) => money(r.med), cls: "c-med", title: "Half of all listed units are cheaper than this" },
  units: { label: "Supply", num: true, sort: (r) => r.units, render: (r) => html`<span class="units">${fmtInt(r.units)}</span>`, cls: "c-units", title: "Units listed" },
  listings: { label: "Listings", num: true, sort: (r) => r.listings, render: (r) => fmtInt(r.listings), cls: "c-list", title: "Number of auctions" },
  change: { label: (ctx) => ctx.range.label, num: true, sort: (r, ctx) => ctx.change(r) ?? -Infinity,
    render: (r, ctx) => change(ctx.change(r)), cls: "c-chg", title: "Price change (median)" },
  trend: { label: "Trend", render: (r, ctx) => sparkline(ctx.spark(r), { dir: ctx.change(r) }), cls: "c-spark", nosort: true },
  spread: { label: "Spread", render: (r) => spreadBar(r), cls: "c-spread", nosort: true, title: "How far the cheapest listing sits below the median" },
  seen: { label: "Last seen", num: true, sort: (r) => r.seen, render: (r, ctx) => html`<span class="muted">${relTime(r.seen, ctx.now)}</span>`, cls: "c-seen" },
  remove: { label: "", render: (r) => html`<button class="icon-btn" type="button" data-action="unwatch" data-id="${r.id}" aria-label="Remove ${r.name} from watchlist">${icon("close", { size: 16 })}</button>`, cls: "c-act", nosort: true },
};

export const DEFAULT_COLS = ["item", "p10", "min", "med", "units", "listings", "change", "trend", "spread", "seen"];

export function sortRows(rows, sortId, dir, ctx) {
  const col = COLUMNS[sortId] || COLUMNS.listings;
  const f = (r) => col.sort(r, ctx);
  const m = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = f(a), y = f(b);
    return (x < y ? -1 : x > y ? 1 : 0) * m || b.listings - a.listings;
  });
}

// ctx: { range, change(row), spark(row), now, sort, dir, limit, showCat }
export function renderTable(rows, cols, ctx) {
  const shown = rows.slice(0, ctx.limit || PAGE);
  const head = cols.map((id) => {
    const c = COLUMNS[id];
    const label = typeof c.label === "function" ? c.label(ctx) : c.label;
    if (c.nosort || ctx.sortable === false) return html`<th class="${c.cls}${c.num ? " num" : ""}" scope="col" title="${c.title || ""}">${label}</th>`;
    const active = ctx.sort === id;
    const aria = active ? (ctx.dir === "asc" ? "ascending" : "descending") : "none";
    return html`<th class="${c.cls}${c.num ? " num" : ""}${active ? " sorted" : ""}" scope="col" aria-sort="${aria}">
      <button type="button" data-sort="${id}" title="${c.title || ""}">${label}<span class="sort-ind" aria-hidden="true">${active ? (ctx.dir === "asc" ? "↑" : "↓") : ""}</span></button></th>`;
  });
  const body = shown.map((r) => html`<tr data-href="${itemHref(r)}">${cols.map((id) => {
    const c = COLUMNS[id];
    return html`<td class="${c.cls}${c.num ? " num" : ""}">${c.render(r, ctx)}</td>`;
  })}</tr>`);
  const more = rows.length > shown.length
    ? html`<div class="table-more"><button class="btn" type="button" data-action="more">Show more</button><span class="muted">${fmtInt(shown.length)} of ${fmtInt(rows.length)}</span></div>`
    : "";
  return html`<div class="table-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
}

// Row clicks open the item; the link inside keeps keyboard and middle-click working.
export function bindRowClicks(root) {
  root.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    if (e.target.closest("a, button, input, select")) return;
    const tr = e.target.closest("tr[data-href]");
    if (tr) location.hash = tr.dataset.href;
  });
}
