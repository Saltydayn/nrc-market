// Small shared pieces: money, change badge, item icon, item name, sparkline, warnings.
import { html, raw, esc } from "../dom.js";
import { moneyParts, moneyLabel, fmtPct, changeDir } from "../format.js";
import { icon } from "./icons.js";

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/";
const SIZES = { small: 18, medium: 36, large: 56 };

export function money(copper, { cls = "" } = {}) {
  const parts = moneyParts(copper);
  if (!parts.length) return html`<span class="money muted ${cls}">—</span>`;
  const inner = parts.map(([v, u]) =>
    `<span class="m-${u}">${u === "g" ? v.toLocaleString("en-US") : v}<i class="coin coin-${u}"></i></span>`).join("");
  return raw(`<span class="money ${cls}" role="img" aria-label="${moneyLabel(copper)}">${inner}</span>`);
}

export function change(f, { arrow = true, cls = "" } = {}) {
  const d = changeDir(f);
  const k = f == null ? "na" : d > 0 ? "up" : d < 0 ? "down" : "flat";
  const glyph = arrow && d !== 0 ? (d > 0 ? "▲" : "▼") : "";
  const title = f == null ? ' title="Not enough history yet"' : "";
  return raw(`<span class="chg chg-${k} ${cls}"${title}>${glyph ? `<span class="chg-a" aria-hidden="true">${glyph}</span>` : ""}${fmtPct(f)}</span>`);
}

// Icon with a fixed-size placeholder behind it, so nothing moves while it loads or if it fails.
export function itemIcon(row, size = "medium") {
  const px = SIZES[size];
  const letter = row && row.named ? esc(row.name[0]) : "?";
  const img = row && row.icon
    ? `<img class="ico-img" src="${ICON_BASE}${size}/${esc(row.icon)}.jpg" width="${px}" height="${px}" alt="" loading="lazy" decoding="async">`
    : "";
  return raw(`<span class="ico ico-${size} q${row?.q ?? 1}" aria-hidden="true"><span class="ico-ph">${letter}</span>${img}</span>`);
}

export function itemName(row, { tag = "span", cls = "" } = {}) {
  return raw(`<${tag} class="iname q${row.q ?? 1}${row.named ? "" : " unnamed"} ${cls}">${esc(row.name)}</${tag}>`);
}

// SVG sparkline. null values are gaps. Colour follows first → last direction.
export function sparkline(values, { w = 88, h = 26, cls = "", dir = null } = {}) {
  if (!values || values.filter((v) => v != null).length < 2) {
    return raw(`<span class="spark spark-none ${cls}" style="width:${w}px;height:${h}px" aria-hidden="true"></span>`);
  }
  // one odd hour shouldn't flatten the rest: clamp to 3 interquartile ranges
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)], q3 = sorted[Math.ceil((sorted.length - 1) * 0.75)];
  const fence = Math.max(q3 - q1, q3 * 0.02) * 3;
  values = values.map((v) => (v == null ? null : Math.min(q3 + fence, Math.max(q1 - fence, v))));
  const nums = values.filter((v) => v != null);
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (hi === lo) { hi += 1; lo -= 1; }
  const step = (w - 4) / (values.length - 1);
  const y = (v) => (h - 3 - ((v - lo) / (hi - lo)) * (h - 6)).toFixed(1);
  let d = "", pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${(2 + i * step).toFixed(1)} ${y(v)}`;
    pen = true;
  });
  const first = nums[0], last = nums[nums.length - 1];
  const d = dir != null ? changeDir(dir) : changeDir(last / first - 1);
  const k = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return raw(`<svg class="spark spark-${k} ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/></svg>`);
}

export function warnings(list, { compact = false } = {}) {
  if (!list || !list.length) return "";
  if (compact) {
    return raw(`<span class="warn-dot" title="${esc(list.map((w) => w.text).join(" "))}">${icon("warn", { size: 14, label: "Data warning" })}</span>`);
  }
  return html`<ul class="warns">${list.map((w) => html`<li>${icon("warn", { size: 14 })}<span>${w.text}</span></li>`)}</ul>`;
}

export const CONF_LABEL = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };
export function confidence(level) {
  return html`<span class="conf conf-${level}"><span class="conf-bars" aria-hidden="true"><i></i><i></i><i></i></span>${CONF_LABEL[level]}</span>`;
}

export function loadingBlock(h = 240) {
  return raw(`<div class="ph-block" style="height:${h}px" aria-busy="true" aria-label="Loading"></div>`);
}

export function errorBlock(msg = "The market data didn't load.") {
  return html`<div class="state-msg"><p>${msg}</p><button class="btn" data-action="retry" type="button">Try again</button></div>`;
}
