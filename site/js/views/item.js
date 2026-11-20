// Item page: everything we know about one item, from "now" to the long history.
import { html, setHTML, $, setQuery } from "../dom.js";
import { now } from "../clock.js";
import { fmtInt, fmtPct, fmtSold, fmtRate, relTime, fmtDay, fmtClock, moneyText, moneyGame, berlin, fmtCompact } from "../format.js";
import { catLabel, catPath } from "../categories.js";
import { parseLadder, baseId, suffixOf, MIN_LISTINGS } from "../model.js";
import {
  CHART_RANGES, getRange, chartUsesHourly, rangeSeconds, rangeChange, trendOf, usualRange, dataQuality, hourProfile, similarItems,
} from "../analysis.js";
import { loadHistory, loadDaily } from "../data.js";
import { isWatched, toggleWatch } from "../store.js";
import { money, change, itemIcon, itemName, warnings, confidence } from "../ui/bits.js";
import { icon } from "../ui/icons.js";
import { createChart } from "../ui/chart.js";
import { bindRowClicks } from "../ui/table.js";
import { pickRange, rememberRange, rangeSeg, crumbs, miniList } from "./common.js";

const WOWHEAD = "https://www.wowhead.com/forever/item=";

export async function render(root, { market, parts, query }) {
  const key = parts[0] || "";
  const id = baseId(key);
  const row = market.byId.get(id);
  if (!row) return unknown(root, market, id);

  const focus = suffixOf(key) != null && row.variants ? row.variants.find((v) => v.key === key) : null;
  const cur = focus ? { ...row, ...focus, value: focus.p10 * focus.units } : row;
  const chartKey = focus ? focus.key : row.key;
  const t = now();
  const path = "/item/" + key;
  let range = pickRange(query, "item", "7d", CHART_RANGES);

  // For suffix gear without a picked variant, all variants' listings together
  const steps = row.variants && !focus ? mergedSteps(row.variants) : stepsOf(cur);
  const notNewest = cur.seen < market.lastScanHour;
  const watched = () => isWatched(row.id);

  setHTML(root, html`
    ${crumbs([
      { label: "Auction House", href: "#/" },
      ...(row.cat ? [{ label: row.cat.top.label, href: `#/c/${row.cat.top.slug}` }] : []),
      ...(row.cat && row.cat.sub ? [{ label: row.cat.sub.label, href: `#/c/${catPath(row.cat)}` }] : []),
      { label: row.name },
    ])}
    <header class="item-h">
      ${itemIcon(row, "large")}
      <div class="item-h-text">
        <h1>${itemName(row, { tag: "span" })}${focus ? html` <span class="variant-tag">Variant ${fmtSuffix(focus.suffix)}</span>` : ""}</h1>
        <p class="item-meta">${[
          row.cat ? catLabel(row.cat) : "Not categorised yet",
          row.ilvl ? `Item level ${row.ilvl}` : null,
          row.req > 0 ? `Requires level ${row.req}` : null,
          row.stack > 1 ? `Stacks to ${row.stack}` : null,
          `ID ${row.id}`,
        ].filter(Boolean).join(" · ")}</p>
      </div>
      <div class="item-actions">
        <button class="btn watch-btn" type="button" data-action="watch" aria-pressed="${watched()}">${watchLabel(watched())}</button>
        <a class="btn btn-ghost" href="${WOWHEAD}${row.id}" target="_blank" rel="noopener noreferrer"
           title="Opens the item in Wowhead's Forever database">Wowhead ${icon("external", { size: 14 })}</a>
      </div>
    </header>

    <section class="panel item-now" aria-label="Current prices">
      <div class="now-main">
        <div class="now-price">
          <span class="lbl" title="What the cheapest 10% of all listed units cost. Ignores single odd listings.">Market price</span>
          <span class="big">${money(cur.p10)}</span>
          <button class="copy-btn" type="button" data-action="copy" title="Copy as ${moneyGame(cur.p10)}">${icon("copy", { size: 14 })}<span>Copy ${moneyGame(cur.p10)}</span></button>
        </div>
        <dl class="now-grid">
          <div><dt>Min</dt><dd>${money(cur.min)}</dd></div>
          <div><dt>Median</dt><dd>${money(cur.med)}</dd></div>
          <div><dt>Supply</dt><dd>${fmtInt(cur.units)}</dd></div>
          <div><dt>Listings</dt><dd>${fmtInt(cur.listings)}</dd></div>
          <div><dt>6h</dt><dd>${change(cur.ch6)}</dd></div>
          <div><dt>24h</dt><dd>${change(cur.ch24)}</dd></div>
          <div><dt>7d</dt><dd id="ch7">${change(null)}</dd></div>
          <div><dt>Listed value</dt><dd>${money(cur.value)}</dd></div>
        </dl>
      </div>
      <div class="now-foot">
        <span class="${notNewest ? "seen-old" : "muted"}">${icon("clock", { size: 14 })}
          ${notNewest ? `Not in the newest scan. Last seen ${relTime(cur.seen, t)}.` : `Last seen ${relTime(cur.seen, t)}`}</span>
        <div id="item-warns"></div>
      </div>
    </section>

    ${row.tsm ? tsmPanel(row.tsm, market.tsm, cur, t) : ""}

    <section class="panel" aria-labelledby="hist-h">
      <div class="panel-h hist-h"><h2 id="hist-h">Price history</h2>${rangeSeg(CHART_RANGES, range, "Range")}</div>
      <div class="panel-b">
        <div class="legend" id="hist-legend"></div>
        <div id="hist-chart" class="hist-chart"></div>
        <p class="note" id="hist-note"></p>
      </div>
    </section>

    <div class="item-cols">
      <section class="panel" aria-labelledby="lad-h">
        <div class="panel-h"><h2 id="lad-h">Price steps</h2><span class="panel-note">cheapest listings now</span></div>
        <div class="panel-b">${ladder(steps, cur)}</div>
      </section>
      <section class="panel" aria-labelledby="out-h">
        <div class="panel-h"><h2 id="out-h">Trend &amp; usual range</h2><span class="panel-note">last 14 days</span></div>
        <div class="panel-b" id="outlook"><div class="ph-block" style="height:150px"></div></div>
      </section>
    </div>

    <section class="panel" aria-labelledby="tod-h">
      <div class="panel-h"><h2 id="tod-h">Time of day</h2><span class="panel-note">Berlin time · from the chart's hourly data</span></div>
      <div class="panel-b" id="tod"></div>
    </section>

    ${row.variants ? variantsTable(row, focus, t) : ""}

    ${similarBlock(row, market)}
  `);

  // ---- history chart ----
  const box = $("#hist-chart", root);
  box.setAttribute("aria-label", `Price history chart for ${row.name}. Use the arrow keys to move through the points.`);
  const chart = createChart(box, { height: 260, volHeight: 60, lines: [], yFmt: axisMoney, volFmt: (n) => `${fmtCompact(n)} units` });
  let token = 0;
  let hourly = [];

  async function loadChart() {
    const my = ++token;
    const hourlyMode = chartUsesHourly(range);
    const lines = hourlyMode
      ? [{ key: "a", cls: "l-a", label: "Market price" }, { key: "b", cls: "l-b", label: "Median" }]
      : [{ key: "a", cls: "l-a", label: "Market price" }, { key: "b", cls: "l-b", label: "Median" }];
    setHTML($("#hist-legend", root), html`${lines.map((l) => html`<span><i class="lg-${l.key}"></i>${l.label}</span>`)}<span><i class="lg-v"></i>Units listed</span>`);
    const tip = (p) => `<div class="t">${hourlyMode ? `${fmtDay(p.t, { weekday: true })}, ${fmtClock(p.t)}` : fmtDay(p.t, { weekday: true })}</div><dl>
      <dt>${lines[0].label}</dt><dd>${String(money(p.a))}</dd><dt>Median</dt><dd>${String(money(p.b))}</dd>
      ${hourlyMode ? `<dt>Min</dt><dd>${String(money(p.m))}</dd>` : ""}
      <dt>Supply</dt><dd>${fmtInt(p.u)}</dd>${hourlyMode ? `<dt>Listings</dt><dd>${fmtInt(p.l)}</dd>` : ""}</dl>`;
    chart.update([], { lines, tip, step: hourlyMode ? 3600 : 86400, emptyText: "Loading history…" });
    const note = $("#hist-note", root);
    note.textContent = "";
    const from = range.days === Infinity ? -Infinity : t - rangeSeconds(range);
    try {
      let pts;
      if (hourlyMode) {
        pts = await loadHistory(chartKey, from, (part) => { if (my === token) chart.update(part); });
        hourly = pts;
      } else {
        const d = await loadDaily(range);
        pts = d.seriesOf(chartKey).filter((x) => x.t >= from).map((x) => ({ t: x.t, a: x.p10, b: x.med, u: x.units }));
      }
      if (my !== token) return;
      chart.update(pts, { emptyText: "No history in this range yet." });
      const bits = [];
      if (pts.length && (range.days === Infinity || pts[0].t > from + (hourlyMode ? 6 * 3600 : 2 * 86400))) bits.push(`History starts ${fmtDay(pts[0].t)}.`);
      if (row.variants && !focus) bits.push(`Shows variant ${fmtSuffix(suffixOf(chartKey))}, the cheapest right now.`);
      if (chart.clipped()) bits.push("Small marks at the top or bottom edge are points far outside the usual range, cut off so they don't flatten the chart.");
      note.textContent = bits.join(" ");
      renderTimeOfDay(hourlyMode ? pts : null);
    } catch (e) {
      console.warn(e);
      if (my !== token) return;
      chart.update([], { emptyText: "The history didn't load." });
      note.innerHTML = String(html`<button class="btn" type="button" data-action="reload-chart">Try again</button>`);
    }
  }

  function renderTimeOfDay(points) {
    const el = $("#tod", root);
    if (!points) {
      setHTML(el, html`<p class="muted small">Pick a range of 30 days or less to see prices by hour.</p>`);
      return;
    }
    const prof = hourProfile(points, (x) => berlin(x).h);
    setHTML(el, timeOfDay(prof));
  }

  // ---- trend & outlook (daily files, last 14 days) ----
  loadDaily(getRange("14d")).then((d) => {
    const series = d.seriesOf(chartKey);
    const c7 = rangeChange(cur, getRange("7d"), series, d.today);
    setHTML($("#ch7", root), change(c7));
    const q = dataQuality(cur, series, d.today);
    setHTML($("#item-warns", root), warnings(q.warnings));
    setHTML($("#outlook", root), outlook(trendOf(series, cur.p10, d.today), usualRange(series, cur.p10, d.today), c7, q, cur));
  }).catch((e) => {
    console.warn(e);
    setHTML($("#outlook", root), html`<p class="muted small">Trends aren't available right now.</p>`);
  });

  root.addEventListener("click", async (e) => {
    const rb = e.target.closest("[data-range]");
    if (rb) {
      range = getRange(rb.dataset.range, CHART_RANGES);
      rememberRange("item", range);
      root.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === rb)));
      setQuery(path, { range: range.id });
      loadChart();
      return;
    }
    if (e.target.closest("[data-action=reload-chart]")) { loadChart(); return; }
    const w = e.target.closest("[data-action=watch]");
    if (w) {
      const on = toggleWatch(row.id);
      w.setAttribute("aria-pressed", String(on));
      setHTML(w, watchLabel(on));
      return;
    }
    const c = e.target.closest("[data-action=copy]");
    if (c) {
      const text = moneyGame(cur.p10);
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = fallbackCopy(text); }
      const span = c.querySelector("span");
      span.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => { span.textContent = `Copy ${text}`; }, 1600);
    }
  });
  const vt = $("#variants", root);
  if (vt) bindRowClicks(vt);

  loadChart();
  return () => chart.destroy();
}

function watchLabel(on) {
  return html`${icon("star", { size: 16, fill: on })}<span>${on ? "Watching" : "Watch"}</span>`;
}

function fmtSuffix(s) {
  return s == null ? "" : String(s).replace("-", "−");
}

// Short money for chart axes: whole gold above 10g, else silver
function axisMoney(v) {
  if (v >= 100000) return Math.round(v / 10000).toLocaleString("en-US") + "g";
  return moneyText(Math.round(v));
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

function stepsOf(e) {
  const steps = parseLadder(e.ladder);
  if (!steps.length && e.listings === 1) steps.push({ price: e.min, units: e.units });
  return steps;
}

function mergedSteps(variants) {
  const by = new Map();
  for (const v of variants) for (const st of stepsOf(v)) by.set(st.price, (by.get(st.price) || 0) + st.units);
  return [...by].map(([price, units]) => ({ price, units })).sort((x, y) => x.price - y.price).slice(0, 10);
}

function ladder(steps, cur) {
  if (!steps.length) return html`<p class="muted small">No price steps in this scan.</p>`;
  const max = Math.max(...steps.map((s) => s.units));
  let cum = 0;
  return html`<p class="note">Each bar is the number of units listed at that price. “Up to here” adds them up, so you can see what buying out costs.</p>
    <ol class="ladder">${steps.map((s) => {
      cum += s.units;
      const w = Math.max(1.5, (s.units / max) * 100).toFixed(1);
      return html`<li><span class="lad-p">${money(s.price)}</span><span class="lad-bar"><i style="width:${w}%"></i></span>
        <span class="lad-u">${fmtInt(s.units)}</span><span class="lad-c">up to here ${fmtInt(cum)}</span></li>`;
    })}</ol>
    ${cur.listings > steps.length && steps.length >= 10 ? html`<p class="note">Showing the 10 cheapest steps of ${fmtInt(cur.listings)} listings.</p>` : ""}`;
}

function outlook(tr, ur, c7, q, cur) {
  if ((cur.listings ?? 0) < MIN_LISTINGS) {
    return html`<p class="outlook-lead">Not enough data</p>
      <p class="muted small">Only ${fmtInt(cur.listings)} ${cur.listings === 1 ? "listing" : "listings"}: one seller sets this price, so there's no trend to read.</p>`;
  }
  if (!ur) {
    return html`<p class="outlook-lead">Not enough data yet</p>
      <p class="muted small">We need at least 5 days of scans after launch week. Right now we have ${q.days}.</p>`;
  }
  if (ur.swing > 1) {
    return html`<p class="outlook-lead">Too jumpy for a range</p>
      <dl class="kv"><div><dt>Last 7 days</dt><dd>${change(c7)}</dd></div><div><dt>Based on</dt><dd>${ur.days} days</dd></div></dl>
      <p class="muted small">Its daily price often more than doubles or halves, usually because a few odd listings come and go. Check the price steps before you trust any number here.</p>`;
  }
  const dir = tr && tr.steady ? (tr.perWeek > 0 ? "Rising steadily" : "Falling steadily")
    : c7 == null ? "No clear direction yet"
    : Math.abs(c7) < 0.03 ? "Holding steady"
    : c7 > 0 ? "Up this week, no steady trend" : "Down this week, no steady trend";
  const order = ["low", "medium", "high"];
  let conf = ur.days >= 14 ? "high" : ur.days >= 7 ? "medium" : "low";
  if (q.warnings.some((w) => w.id === "volatile") || ur.swing > 0.2) conf = order[Math.max(0, order.indexOf(conf) - 1)];
  return html`
    <p class="outlook-lead">${dir}</p>
    <dl class="kv">
      <div><dt>Last 7 days</dt><dd>${change(c7)}</dd></div>
      <div><dt>Usual daily swing</dt><dd title="Typical size of one day's price move over the last ${ur.days} days">±${fmtPct(ur.swing, { sign: false })}</dd></div>
      <div><dt>Based on</dt><dd>${ur.days} days</dd></div>
    </dl>
    <div class="proj">
      <span class="lbl">Usual range for the next days</span>
      <span class="proj-v">${money(ur.lo)} – ${money(ur.hi)}</span>
      ${confidence(conf)}
    </div>
    <p class="note">Today's market price plus or minus its usual daily swing. It says how far the price normally moves, not which way: in our tests no trend line beat "it stays about where it is". Launch week (5–7 Nov) is left out.</p>`;
}

function timeOfDay(prof) {
  const { hours, days } = prof;
  const withData = hours.filter((h) => h.dev != null);
  if (days < 2 || withData.length < 12) {
    return html`<p class="muted small">Not enough hourly data yet. Pick 7 days or more once we have a few days of scans.</p>`;
  }
  const maxDev = Math.max(0.01, ...withData.map((h) => Math.abs(h.dev)));
  const lo = withData.reduce((a, b) => (b.dev < a.dev ? b : a));
  const hi = withData.reduce((a, b) => (b.dev > a.dev ? b : a));
  const maxU = Math.max(1, ...withData.map((h) => h.units || 0));
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const flat = hi.dev - lo.dev < 0.02;
  return html`
    <p class="tod-lead">${flat ? "No real difference between hours." : html`Cheapest around <strong>${hh(lo.hour)}</strong> (${fmtPct(lo.dev)}), priciest around <strong>${hh(hi.hour)}</strong> (${fmtPct(hi.dev)}).`}
      <span class="muted">Compared with each day's median, from ${days} days.</span></p>
    ${days < 7 ? warnings([{ text: "Fewer than 7 days: this pattern can still change a lot." }]) : ""}
    <div class="tod" role="img" aria-label="Price by hour of day">
      ${hours.map((h) => {
        const up = h.dev != null && h.dev > 0;
        const ht = h.dev == null ? 0 : (Math.abs(h.dev) / maxDev) * 46;
        const cls = h === lo ? " lo" : h === hi ? " hi" : "";
        const uh = h.units ? Math.max(2, (h.units / maxU) * 22) : 0;
        return html`<div class="tod-col${cls}" title="${hh(h.hour)}: ${h.dev == null ? "no data" : fmtPct(h.dev)}${h.units ? `, ${fmtInt(h.units)} units` : ""}">
          <span class="tod-bar ${up ? "pos" : "neg"}" style="height:${ht.toFixed(1)}px"></span>
          <span class="tod-sup" style="height:${uh.toFixed(1)}px"></span>
          <span class="tod-x">${h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}</span>
        </div>`;
      })}
    </div>
    <div class="legend tod-legend"><span><i class="lg-a"></i>Price vs. day median</span><span><i class="lg-v"></i>Units listed</span></div>`;
}

function variantsTable(row, focus, t) {
  return html`<section class="panel" aria-labelledby="var-h">
    <div class="panel-h"><h2 id="var-h">Variants</h2><span class="panel-note">random suffixes, names not known yet</span></div>
    <div id="variants"><table class="tbl var-tbl"><thead><tr><th scope="col">Variant</th><th class="num" scope="col">Market</th><th class="num" scope="col">Min</th>
      <th class="num" scope="col">Supply</th><th class="num" scope="col">Listings</th><th class="num" scope="col">24h</th><th class="num" scope="col">Last seen</th></tr></thead>
    <tbody>${row.variants.map((v) => html`<tr data-href="#/item/${encodeURIComponent(v.key)}" class="${focus && focus.key === v.key ? "focus" : ""}">
      <td class="c-item"><a href="#/item/${encodeURIComponent(v.key)}">${v.suffix == null ? "Base item" : `Variant ${fmtSuffix(v.suffix)}`}</a></td>
      <td class="num c-p10">${money(v.p10)}</td><td class="num">${money(v.min)}</td><td class="num c-units">${fmtInt(v.units)}</td>
      <td class="num">${fmtInt(v.listings)}</td><td class="num c-chg">${change(v.ch24)}</td><td class="num muted">${relTime(v.seen, t)}</td></tr>`)}</tbody></table></div>
    ${focus ? html`<div class="panel-f"><a href="#/item/${row.id}">Show all variants together</a></div>` : ""}
  </section>`;
}

function similarBlock(row, market) {
  const sim = similarItems(row, market.named);
  if (!sim.length) return "";
  return html`<section class="panel" aria-labelledby="sim-h">
    <div class="panel-h"><h2 id="sim-h">Similar items</h2><span class="panel-note">same category, close in price</span></div>
    ${miniList(sim, { chg: (r) => r.ch24 })}
  </section>`;
}

// What TSM adds to our own numbers: sales, and its Horde price when our last scan of the item is old
function tsmPanel(tr, tsm, cur, t) {
  const stale = tr.min && tsm.realmAt && cur.seen < tsm.realmAt && t - cur.seen > 6 * 3600;
  return html`<section class="panel" aria-labelledby="tsm-h">
    <div class="panel-h"><h2 id="tsm-h">Sales</h2><span class="panel-note">from TSM</span></div>
    <div class="panel-b">
      <dl class="now-grid tsm-grid">
        <div><dt title="Sold per day across all EU Forever auction houses">Sold per day</dt><dd>${fmtSold(tr.sold)}</dd></div>
        <div><dt title="Share of listings that actually sell">Sell rate</dt><dd>${fmtRate(tr.rate)}</dd></div>
        <div><dt>Average sale</dt><dd>${money(tr.avg)}</dd></div>
        <div><dt title="TSM's market value on the Horde auction house: an average over several days">TSM market value</dt><dd>${money(tr.mv)}</dd></div>
      </dl>
      ${stale ? html`<p class="note">TSM saw this item more recently than our scans: cheapest ${moneyText(tr.min)} on the Horde AH ${relTime(tsm.realmAt, t)}.</p>` : ""}
      <p class="note">Sales cover all EU Forever auction houses, both factions${tsm.regionAt ? `, updated ${relTime(tsm.regionAt, t)}` : ""}.
        TSM's market value is a multi-day average and can lag behind the prices above.</p>
    </div>
  </section>`;
}

// An item nobody in the guild has scanned, but TSM has seen on the Horde AH
function tsmOnlyPage(root, market, row) {
  const tr = row.tsm, t = now(), tsm = market.tsm;
  setHTML(root, html`
    ${crumbs([{ label: "Auction House", href: "#/" }, { label: row.name }])}
    <header class="item-h">
      ${itemIcon(row, "large")}
      <div class="item-h-text">
        <h1>${itemName(row, { tag: "span" })}</h1>
        <p class="item-meta">${[row.cat ? catLabel(row.cat) : null, row.ilvl ? `Item level ${row.ilvl}` : null, `ID ${row.id}`].filter(Boolean).join(" · ")}</p>
      </div>
      <div class="item-actions">
        <a class="btn btn-ghost" href="${WOWHEAD}${row.id}" target="_blank" rel="noopener noreferrer">Wowhead ${icon("external", { size: 14 })}</a>
      </div>
    </header>
    <section class="panel item-now" aria-label="TSM prices">
      <div class="now-main">
        <div class="now-price">
          <span class="lbl" title="TSM's most recent price on the Horde auction house">TSM price</span>
          <span class="big">${money(row.p10)}</span>
        </div>
        <dl class="now-grid">
          <div><dt>Cheapest</dt><dd>${money(tr.min)}</dd></div>
          <div><dt title="An average over several days">Market value</dt><dd>${money(tr.mv)}</dd></div>
          <div><dt>Historical</dt><dd>${money(tr.hist)}</dd></div>
          <div><dt>Sold per day</dt><dd>${fmtSold(tr.sold)}</dd></div>
        </dl>
      </div>
      <div class="now-foot"><span class="muted">${icon("clock", { size: 14 })}
        Nobody in the guild has scanned this item yet, so these are TSM's numbers${tsm.realmAt ? ` (Horde AH, ${relTime(tsm.realmAt, t)})` : ""}. No history, price steps or trend until one of our scans sees it.</span></div>
    </section>
  `);
}

function unknown(root, market, id) {
  const only = market.tsmOnly?.get(id);
  if (only) return tsmOnlyPage(root, market, only);
  const name = market.names[id]?.en;
  setHTML(root, html`<div class="state-msg">
    <h1>${name ? html`We haven't seen ${name} in the last 2 days.` : "We haven't seen this item in the last 2 days."}</h1>
    <p>It may not be listed right now, or the ID is wrong.</p>
    <form class="inline-search" id="miss-form"><input class="field" name="q" type="search" placeholder="Search items or IDs" aria-label="Search items"><button class="btn" type="submit">Search</button></form>
  </div>`);
  $("#miss-form", root).addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q").trim();
    if (q) location.hash = "#/search?q=" + encodeURIComponent(q);
  });
}

