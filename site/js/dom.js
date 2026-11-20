// Tiny templating: html`...` escapes every interpolated value unless it's already html.

class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function part(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Html(out);
}

export const raw = (s) => new Html(String(s));

export function setHTML(el, h) {
  el.innerHTML = String(h);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// URL-hash helpers. replace=true updates the URL without adding a history step.
export function hashFor(path, query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== "") q.set(k, v);
  const s = q.toString();
  return "#" + path + (s ? "?" + s : "");
}

export function setQuery(path, query) {
  history.replaceState(history.state, "", location.pathname + location.search + hashFor(path, query));
}
