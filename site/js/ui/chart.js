// Hand-made SVG time chart: up to two price lines and supply bars underneath.
// Gaps stay gaps. The y-axis covers the 2nd–98th percentile; values outside are pinned to
// the edge with a small marker so one odd hour can't flatten everything else.
import { berlin, fmtDay } from "../format.js";
import { percentile } from "../analysis.js";

const DAY = 86400;

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// Berlin-midnight of the Berlin calendar day containing unix time t
function berlinMidnight(t) {
  const b = berlin(t);
  return t - b.h * 3600 - b.mi * 60 - (t % 60);
}

function timeTicks(x0, x1, maxTicks) {
  const span = x1 - x0;
  const hourSteps = [1, 2, 3, 6, 12];
  for (const k of hourSteps) {
    if (span / (k * 3600) <= maxTicks) {
      const out = [];
      for (let t = Math.ceil(x0 / 3600) * 3600; t <= x1; t += 3600) {
        const b = berlin(t);
        if (b.h % k === 0) out.push({ t, label: b.h === 0 ? fmtDay(t) : `${String(b.h).padStart(2, "0")}:00`, major: b.h === 0 });
      }
      return out;
    }
  }
  for (const k of [1, 2, 7, 14]) {
    if (span / (k * DAY) <= maxTicks) {
      const out = [];
      for (let t = berlinMidnight(x0) + DAY; t <= x1 + 3600; t = berlinMidnight(t + DAY + 7200)) {
        const b = berlin(t);
        const dayNo = Date.UTC(b.y, b.mo - 1, b.d) / 864e5;
        // weekly ticks land on Mondays
        if (k >= 7 ? b.dow === 1 && (k === 7 || Math.floor(dayNo / 7) % 2 === 0) : dayNo % k === 0) {
          out.push({ t, label: fmtDay(t), major: false });
        }
      }
      return out;
    }
  }
  const out = [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const every = span / (30 * DAY) <= maxTicks ? 1 : span / (91 * DAY) <= maxTicks ? 3 : 6;
  const d = new Date(x0 * 1000);
  for (let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; ; m++) {
    if (m === 12) { m = 0; y++; }
    const t = Date.UTC(y, m, 1) / 1000;
    if (t > x1) break;
    if (m % every === 0) out.push({ t, label: m === 0 ? `${months[m]} ${y}` : months[m], major: m === 0 });
  }
  return out;
}

export function createChart(host, opts) {
  const o = { height: 240, volHeight: 56, step: 3600, lines: [], yFmt: String, tip: () => "", ...opts };
  host.classList.add("chart");
  host.tabIndex = 0;
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;

  let pts = [];
  let g = null; // geometry of the last draw
  let idx = -1;
  let lastW = 0;
  let clipped = 0;

  function draw() {
    const W = host.clientWidth;
    lastW = W;
    if (!W) return;
    const narrow = W < 520;
    const H = narrow ? Math.round(o.height * 0.8) : o.height;
    const VH = o.volHeight;
    const ML = 4, MR = narrow ? 58 : 76;
    const pT = 8, pB = pT + H, vT = pB + 14, vB = vT + VH, axY = vB + 20;
    const plotW = W - ML - MR;

    if (!pts.length) {
      host.innerHTML = `<div class="chart-empty" style="height:${axY + 6}px"><span>${o.emptyText || "No history in this range yet."}</span></div>`;
      g = null;
      return;
    }

    let x0 = pts[0].t, x1 = pts[pts.length - 1].t;
    if (x1 - x0 < o.step * 2) { x0 -= o.step; x1 += o.step; }
    const xs = (t) => ML + ((t - x0) / (x1 - x0)) * plotW;

    const vals = [];
    for (const p of pts) for (const l of o.lines) if (Number.isFinite(p[l.key])) vals.push(p[l.key]);
    vals.sort((a, b) => a - b);
    let lo = vals.length >= 20 ? percentile(vals, 0.02) : vals[0];
    let hi = vals.length >= 20 ? percentile(vals, 0.98) : vals[vals.length - 1];
    if (hi - lo < Math.abs(hi) * 0.02 || hi === lo) { const m = Math.abs(hi) * 0.05 || 1; lo -= m; hi += m; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    if (o.floorZero !== false && lo < 0 && vals[0] >= 0) lo = 0;
    const ys = (v) => pB - ((v - lo) / (hi - lo)) * H;

    clipped = 0;
    let s = `<svg width="${W}" height="${axY + 6}" viewBox="0 0 ${W} ${axY + 6}" aria-hidden="true">`;

    // y grid + labels
    const yStep = niceStep((hi - lo) / (narrow ? 3 : 4));
    for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) {
      const y = ys(v).toFixed(1);
      s += `<line class="grid" x1="${ML}" x2="${ML + plotW}" y1="${y}" y2="${y}"/>`;
      s += `<text class="ylab" x="${W - 2}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${o.yFmt(v)}</text>`;
    }
    if (o.zeroLine && lo < 0 && hi > 0) {
      const y = ys(0).toFixed(1);
      s += `<line class="zero" x1="${ML}" x2="${ML + plotW}" y1="${y}" y2="${y}"/>`;
    }

    // x ticks
    const ticks = timeTicks(x0, x1, Math.max(2, Math.floor(plotW / (narrow ? 70 : 90))));
    for (const t of ticks) {
      const x = xs(t.t).toFixed(1);
      s += `<line class="grid${t.major ? " major" : ""}" x1="${x}" x2="${x}" y1="${pT}" y2="${vB}"/>`;
      s += `<text class="xlab" x="${x}" y="${axY}" text-anchor="middle">${t.label}</text>`;
    }

    // supply bars
    const us = pts.map((p) => p.u).filter(Number.isFinite);
    if (us.length) {
      const maxU = Math.max(...us) || 1;
      const slots = Math.max(1, (x1 - x0) / o.step);
      const bw = Math.max(1, Math.min(16, (plotW / slots) * 0.62));
      let bars = "";
      for (const p of pts) {
        if (!Number.isFinite(p.u)) continue;
        const h = Math.max(1, (p.u / maxU) * VH);
        bars += `M${(xs(p.t) - bw / 2).toFixed(1)} ${vB}v${(-h).toFixed(1)}h${bw.toFixed(1)}v${h.toFixed(1)}z`;
      }
      s += `<path class="vol" d="${bars}"/>`;
      s += `<text class="ylab" x="${W - 2}" y="${vT + 10}" text-anchor="end">${o.volFmt ? o.volFmt(maxU) : maxU}</text>`;
    }
    s += `<line class="axis" x1="${ML}" x2="${ML + plotW}" y1="${vB}" y2="${vB}"/>`;

    // price lines; a step longer than 1.5× the data step is a gap
    for (const l of o.lines) {
      let d = "", dots = "", marks = "", prev = null, run = 0, runStart = null, nClip = 0;
      const flush = () => { if (run === 1 && runStart) dots += `<circle cx="${runStart[0]}" cy="${runStart[1]}" r="2"/>`; };
      for (const p of pts) {
        const v = p[l.key];
        if (!Number.isFinite(v)) { flush(); prev = null; run = 0; continue; }
        const edge = v > hi ? "hi" : v < lo ? "lo" : null;
        const x = xs(p.t).toFixed(1);
        const y = ys(Math.min(hi, Math.max(lo, v))).toFixed(1);
        if (edge) { marks += edge === "hi" ? `<path d="M${x} ${pT}l-3.5 6h7z"/>` : `<path d="M${x} ${pB}l-3.5 -6h7z"/>`; nClip++; }
        const gap = !prev || p.t - prev.t > o.step * 1.5;
        if (gap) { flush(); run = 0; runStart = [x, y]; }
        d += `${gap ? "M" : "L"}${x} ${y}`;
        run++;
        prev = p;
      }
      flush();
      clipped += nClip;
      s += `<path class="ln ${l.cls}" d="${d}"/><g class="dots ${l.cls}">${dots}</g><g class="clip-mark ${l.cls}">${marks}</g>`;
    }

    s += `<g class="xh" visibility="hidden"><line class="xh-line" y1="${pT}" y2="${vB}"/>` +
      o.lines.map((l) => `<circle class="xh-dot ${l.cls}" r="3.5"/>`).join("") + `</g>`;
    s += `<rect class="hit" x="${ML}" y="0" width="${plotW}" height="${axY}" fill="transparent"/>`;
    s += "</svg>";
    host.innerHTML = s;
    host.appendChild(tip);
    g = { xs, ys, lo, hi, pT, pB, x0, x1, ML, plotW, W };
    if (idx >= 0) show(idx); else tip.hidden = true;
  }

  function nearest(t) {
    let a = 0, b = pts.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (pts[m].t < t) a = m; else b = m;
    }
    return Math.abs(pts[a].t - t) <= Math.abs(pts[b].t - t) ? a : b;
  }

  function show(i) {
    if (!g || !pts.length) return;
    idx = Math.max(0, Math.min(pts.length - 1, i));
    const p = pts[idx];
    const x = g.xs(p.t);
    const xh = host.querySelector(".xh");
    xh.setAttribute("visibility", "visible");
    const line = xh.querySelector(".xh-line");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    xh.querySelectorAll(".xh-dot").forEach((c, k) => {
      const v = p[o.lines[k].key];
      if (!Number.isFinite(v)) { c.setAttribute("visibility", "hidden"); return; }
      c.setAttribute("visibility", "visible");
      c.setAttribute("cx", x);
      c.setAttribute("cy", g.ys(Math.min(g.hi, Math.max(g.lo, v))));
    });
    tip.innerHTML = o.tip(p);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = x + 14 + tw > g.W ? x - 14 - tw : x + 14;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${g.pT + 4}px)`;
  }

  function hide() {
    idx = -1;
    tip.hidden = true;
    const xh = host.querySelector(".xh");
    if (xh) xh.setAttribute("visibility", "hidden");
  }

  function fromPointer(e) {
    if (!g || !pts.length) return;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = g.x0 + ((x - g.ML) / g.plotW) * (g.x1 - g.x0);
    show(nearest(t));
  }

  host.addEventListener("pointermove", fromPointer);
  host.addEventListener("pointerdown", fromPointer);
  host.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  host.addEventListener("blur", hide);
  host.addEventListener("keydown", (e) => {
    if (!pts.length) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      show(idx < 0 ? pts.length - 1 : idx + (k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
    } else if (k === "Home") { e.preventDefault(); show(0); }
    else if (k === "End") { e.preventDefault(); show(pts.length - 1); }
    else if (k === "Escape") hide();
  });

  const ro = new ResizeObserver(() => { if (host.clientWidth !== lastW) draw(); });
  ro.observe(host);

  return {
    update(points, more = {}) {
      Object.assign(o, more);
      pts = points.filter((p) => o.lines.some((l) => Number.isFinite(p[l.key])) || Number.isFinite(p.u));
      if (idx >= pts.length) idx = -1;
      draw();
    },
    clipped: () => clipped,
    destroy() { ro.disconnect(); },
  };
}
