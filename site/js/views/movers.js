// Movers: biggest risers and fallers for a chosen range, filterable by category.
import { html, setHTML, $, setQuery } from "../dom.js";
import { now } from "../clock.js";
import { fmtInt } from "../format.js";
import { FEATURED, findNode, inNode } from "../categories.js";
import { RANGES, isMoverCandidate, topMovers } from "../analysis.js";
import { money } from "../ui/bits.js";
import { listCtx, pickRange, rememberRange, rangeSeg, dailyFor, miniList } from "./common.js";

export async function render(root, { market, query }) {
  const nodes = FEATURED.map(findNode).filter(Boolean).filter((n) => market.named.some((r) => inNode(r.cat, n)));
  const state = { range: pickRange(query, "movers", "24h"), cat: query.get("cat") || "" };
  let token = 0;

  setHTML(root, html`
    <header class="page-h"><div><h1>Movers</h1>
      <p class="page-sub">Biggest price changes. Only items with at least 5 listings, a median of 1 silver or more and seen in the last 3 hours, so a single odd listing can't win.</p></div></header>
    <div class="list-ctl">${rangeSeg(RANGES, state.range)}</div>
    <div class="chips mv-chips" role="group" aria-label="Category">
      <button class="chip" type="button" data-cat="" aria-pressed="${!state.cat}">All</button>
      ${nodes.map((n) => html`<button class="chip" type="button" data-cat="${n.path}" aria-pressed="${state.cat === n.path}">${n.label}</button>`)}
    </div>
    <div class="mv-grid" id="mv"></div>
  `);

  async function paint() {
    const my = ++token;
    const box = $("#mv", root);
    const t = now();
    const node = state.cat ? findNode(state.cat) : null;
    const pool = market.rows.filter((r) => isMoverCandidate(r, t) && (!node || inNode(r.cat, node)));
    if (state.range.days) setHTML(box, html`<div class="ph-block" style="height:420px"></div><div class="ph-block" style="height:420px"></div>`);
    const daily = await dailyFor(state.range);
    if (my !== token) return;
    const ctx = listCtx(state.range, daily, t);
    const { up, down } = topMovers(pool, (r) => ctx.change(r), 15);
    const col = (title, list, empty) => html`<section class="panel">
      <div class="panel-h"><h2>${title}</h2><span class="panel-note">${state.range.label} · ${fmtInt(list.length)}</span></div>
      ${list.length ? miniList(list.map(([r]) => r), { chg: (r) => ctx.change(r), spark: (r) => ctx.spark(r), value: (r) => money(r.p10) }) : html`<p class="panel-empty">${empty}</p>`}
    </section>`;
    const thin = state.range.days && !up.length && !down.length;
    setHTML(box, html`
      ${col("Rising", up, thin ? "Not enough history for this range yet." : "Nothing rose noticeably.")}
      ${col("Falling", down, thin ? "Not enough history for this range yet." : "Nothing fell noticeably.")}`);
  }

  function sync() { setQuery("/movers", { range: state.range.id, cat: state.cat || null }); }

  root.addEventListener("click", (e) => {
    const rb = e.target.closest("[data-range]");
    if (rb) {
      state.range = RANGES.find((r) => r.id === rb.dataset.range);
      rememberRange("movers", state.range);
      root.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === rb)));
      sync(); paint();
      return;
    }
    const cb = e.target.closest("[data-cat]");
    if (cb) {
      state.cat = cb.dataset.cat;
      root.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b === cb)));
      sync(); paint();
    }
  });
  paint();
}
