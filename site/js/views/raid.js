// Raid mats: herbs, oils, elementals and finished consumables raids burn through, priced against their own
// history and TSM's EU-wide value. Cheap now often means "no raid demand yet", not "safe".
import { html, setHTML, $ } from "../dom.js";
import { fmtInt, fmtPct, fmtSold } from "../format.js";
import { getRange, matStats } from "../analysis.js";
import { money, change, itemIcon, itemName, loadingBlock } from "../ui/bits.js";
import { itemHref, bindRowClicks } from "../ui/table.js";
import { RAID_GROUPS } from "../raidmats.js";
import { dailyFor } from "./common.js";

export async function render(root, { market }) {
  // names → our rows (or TSM-only rows when no guild scan has seen the item yet)
  const byName = new Map();
  for (const r of market.rows) if (r.named) byName.set(r.name, r);
  for (const r of market.tsmOnly.values()) if (r.named && !byName.has(r.name)) byName.set(r.name, r);

  setHTML(root, html`
    <header class="page-h"><div><h1>Raid mats</h1>
      <p class="page-sub">What raids burn through, priced against its own history and the EU-wide value (TSM).
        Cheap now often just means raids haven't started yet: a good time to stock up, not a sure profit.</p></div></header>
    <div id="raid">${loadingBlock(360)}</div>`);
  const box = $("#raid", root);
  bindRowClicks(box);

  const daily = await dailyFor(getRange("30d"));
  if (!$("#raid", root)) return;
  const seriesOf = (r) => (daily && !r.tsmOnly ? daily.seriesOf(r) : []);
  const today = daily?.today;

  setHTML(box, html`${RAID_GROUPS.map((g) => {
    const rows = g.items.map((it) => ({ it, r: byName.get(it.name) })).filter((x) => x.r)
      .map((x) => ({ ...x, st: x.r.tsmOnly ? { cheap: false } : matStats(x.r, seriesOf(x.r), today) }));
    const absent = g.items.filter((it) => !byName.has(it.name)).map((it) => it.name);
    if (!rows.length) return "";
    return html`<section class="panel" aria-labelledby="raid-${g.id}">
      <div class="panel-h"><h2 id="raid-${g.id}">${g.label}</h2><span class="panel-note">${fmtInt(rows.filter((x) => x.st.cheap).length)} cheap right now</span></div>
      <div class="table-wrap"><table class="tbl raid-tbl"><thead><tr>
        <th scope="col">Item</th>
        <th class="num" scope="col" title="What the cheapest 10% of listed units cost">Market</th>
        <th class="num" scope="col" title="Lowest daily market price since launch week">Lowest</th>
        <th class="num" scope="col" title="Market price vs its usual price of the last 7 days">vs usual</th>
        <th class="num" scope="col" title="TSM's market value across all EU Forever auction houses">EU value</th>
        <th class="num" scope="col" title="Our market price vs the EU value">vs EU</th>
        <th class="num" scope="col" title="Sold per day across EU (TSM)">Sold/day</th>
      </tr></thead><tbody>${rows.map(({ it, r, st }) => html`<tr data-href="${itemHref(r)}" class="${st.cheap ? "raid-cheap" : ""}">
        <td class="c-item"><a class="item-link" href="${itemHref(r)}" title="${r.name}">${itemIcon(r, "medium")}<span class="item-text">${itemName(r)}
          <span class="item-sub">${st.cheap ? html`<span class="cheap-tag">Cheap</span> ` : ""}${it.for}${r.tsmOnly ? " · TSM price, not in our scans" : ""}</span></span></a></td>
        <td class="num c-p10">${money(r.p10)}</td>
        <td class="num">${st.low ? money(st.low) : "—"}</td>
        <td class="num">${change(st.vsUsual ?? null)}</td>
        <td class="num">${st.eu ? money(st.eu) : "—"}</td>
        <td class="num">${st.vsEu == null ? "—" : html`<span class="chg ${st.vsEu < -0.005 ? "chg-down" : st.vsEu > 0.005 ? "chg-up" : "chg-flat"}">${fmtPct(st.vsEu)}</span>`}</td>
        <td class="num">${fmtSold(r.sold)}</td></tr>`)}</tbody></table></div>
      ${absent.length ? html`<p class="note panel-f">Not on the auction house yet: ${absent.join(", ")}.</p>` : ""}
    </section>`;
  })}
  <p class="note">"Cheap" = within 10% of its lowest price since launch week, or 30% or more under the EU value.
    The list is hand-picked: tell Saltydayn what's missing.</p>`);
}
