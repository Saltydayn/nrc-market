// Watchlist: items the person starred, stored in this browser only.
import { html, setHTML, $ } from "../dom.js";
import { now } from "../clock.js";
import { RANGES } from "../analysis.js";
import { watchlist, toggleWatch } from "../store.js";
import { unknownName } from "../model.js";
import { renderTable, bindRowClicks } from "../ui/table.js";
import { icon } from "../ui/icons.js";
import { listCtx, pickRange, rememberRange, rangeSeg, dailyFor } from "./common.js";

export async function render(root, { market, query }) {
  let range = pickRange(query, "list", "7d");
  setHTML(root, html`
    <header class="page-h"><div><h1>Watchlist</h1><p class="page-sub">Saved in this browser only.</p></div></header>
    <div class="list-ctl" id="wl-ctl">${rangeSeg(RANGES, range)}</div>
    <div id="wl"></div>`);
  const box = $("#wl", root);
  bindRowClicks(box);

  async function paint() {
    const ids = watchlist();
    if (!ids.length) {
      $("#wl-ctl", root).hidden = true;
      setHTML(box, html`<div class="empty-state">${icon("star", { size: 28 })}
        <p>Nothing here yet. Open any item and press <strong>Watch</strong> to keep it on this list and at the top of the overview.</p></div>`);
      return;
    }
    // Items that dropped out of latest.json stay on the list, shown without prices.
    const rows = ids.map((id) => market.byId.get(id) || missing(id, market));
    const daily = await dailyFor(range);
    const ctx = listCtx(range, daily, now());
    setHTML(box, renderTable(rows, ["item", "p10", "min", "med", "units", "listings", "change", "trend", "seen", "remove"],
      { ...ctx, sortable: false, limit: 500, showCat: true }));
  }

  root.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-action=unwatch]");
    if (rm) { toggleWatch(rm.dataset.id); paint(); return; }
    const rb = e.target.closest("[data-range]");
    if (rb) {
      range = RANGES.find((r) => r.id === rb.dataset.range);
      rememberRange("list", range);
      root.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === rb)));
      paint();
    }
  });
  paint();
}

function missing(id, market) {
  const info = market.names[id];
  return {
    id, key: id, name: info?.en || unknownName(id), named: !!info?.en, q: info?.q ?? 1, icon: info?.icon || null,
    cat: null, p10: null, min: null, med: null, units: null, listings: 0, seen: null, ch6: null, ch24: null, spark: null, variants: null,
  };
}
