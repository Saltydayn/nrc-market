// Header search: instant dropdown, arrows/Enter/Esc, "/" or Ctrl+K to focus.
import { html, setHTML } from "../dom.js";
import { search } from "../search.js";
import { money, itemIcon, itemName } from "./bits.js";
import { itemHref } from "./table.js";
import { catLabel } from "../categories.js";

export function bindSearch(input, market) {
  const list = document.getElementById(input.getAttribute("aria-controls"));
  let hits = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function paint() {
    const q = input.value.trim();
    if (!q) { close(); return; }
    hits = search(market.index, q, 8);
    if (!hits.length) {
      setHTML(list, html`<li class="search-none" role="option" aria-disabled="true">No results</li>`);
    } else {
      setHTML(list, html`${hits.map((r, i) => html`<li id="q-opt-${i}" role="option" aria-selected="${i === active}" class="${i === active ? "on" : ""}">
        <a href="${itemHref(r)}" tabindex="-1">${itemIcon(r, "small")}<span class="sr-name">${itemName(r)}<span class="sr-sub">${r.cat ? catLabel(r.cat) : "#" + r.id}</span></span>${money(r.p10)}</a></li>`)}
        <li class="search-all" role="option" id="q-opt-all" aria-selected="${active === hits.length}"><a href="#/search?q=${encodeURIComponent(q)}" tabindex="-1">All results for “${q}”</a></li>`);
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", active === hits.length ? "q-opt-all" : `q-opt-${active}`);
  }

  function go(hash) {
    close();
    input.blur();
    location.hash = hash;
  }

  input.addEventListener("input", () => { active = -1; paint(); });
  input.addEventListener("focus", () => { if (input.value.trim()) paint(); });
  input.addEventListener("keydown", (e) => {
    const n = hits.length + 1; // + "all results"
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % n; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = active <= 0 ? n - 1 : active - 1; paint(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (active >= 0 && active < hits.length) go(itemHref(hits[active]));
      else go("#/search?q=" + encodeURIComponent(q));
    } else if (e.key === "Escape") {
      if (!list.hidden) close(); else { input.value = ""; input.blur(); }
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus so the click lands
  list.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a) { e.preventDefault(); go(a.getAttribute("href")); }
  });
  input.addEventListener("blur", () => setTimeout(close, 100));

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
