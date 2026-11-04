// Full search results for #/search?q=…
import { html, setHTML, $ } from "../dom.js";
import { now } from "../clock.js";
import { fmtInt } from "../format.js";
import { search } from "../search.js";
import { getRange } from "../analysis.js";
import { renderTable, bindRowClicks, DEFAULT_COLS, PAGE } from "../ui/table.js";
import { listCtx } from "./common.js";

export async function render(root, { market, query }) {
  const q = (query.get("q") || "").trim();
  const hits = search(market.index, q);
  let limit = PAGE;
  const input = document.getElementById("q");
  if (input && document.activeElement !== input) input.value = q;

  setHTML(root, html`
    <header class="page-h"><div><h1>Search</h1>
      <p class="page-sub">${q ? html`${fmtInt(hits.length)} ${hits.length === 1 ? "result" : "results"} for “${q}”` : "Type an item name or ID in the search field."}</p></div></header>
    <div id="sr"></div>`);
  const box = $("#sr", root);
  bindRowClicks(box);
  const ctx = listCtx(getRange("24h"), null, now());

  function paint() {
    if (!q) return;
    if (!hits.length) { setHTML(box, html`<div class="table-wrap"><p class="panel-empty">No results. Try fewer words or part of a name, like “lotus”.</p></div>`); return; }
    setHTML(box, renderTable(hits, DEFAULT_COLS, { ...ctx, sortable: false, limit, showCat: true }));
  }
  root.addEventListener("click", (e) => { if (e.target.closest("[data-action=more]")) { limit += PAGE; paint(); } });
  paint();
}
