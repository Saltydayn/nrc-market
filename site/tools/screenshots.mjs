// Takes the review screenshots: every page at 1440×900 and on an iPhone 13, normal and stress data.
// Needs Playwright (dev only, not part of the site). Serve first: cd site && python3 -m http.server 8000
//   node site/tools/screenshots.mjs [outDir] [filter]
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8000/";
const OUT = process.argv[2] || new URL("../screenshots/", import.meta.url).pathname;
const FILTER = process.argv[3] || "";

const PAGES = [
  ["overview", "#/"],
  ["category-herbs", "#/c/trade-goods/herbs"],
  ["category-trade-goods", "#/c/trade-goods?sort=p10&dir=desc"],
  ["category-recipes", "#/c/recipes"],
  ["item-black-lotus", "#/item/13468"],
  ["item-linen", "#/item/2589?range=30d"],
  ["item-variants", "#/item/15216"],
  ["item-unnamed", "#/item/19019"],
  ["item-missing", "#/item/1"],
  ["movers", "#/movers"],
  ["deals", "#/deals"],
  ["insights", "#/insights"],
  ["watchlist", "#/watchlist"],
  ["watchlist-empty", "#/watchlist", { empty: true }],
  ["search", "#/search?q=lotus"],
  ["search-dropdown", "#/", { type: "flask titans" }],
];
const STRESS = [["overview", "#/"], ["movers", "#/movers"], ["search", "#/search?q=19"], ["category-herbs", "#/c/trade-goods/herbs"]];

const profiles = [
  ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ["phone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];
for (const [pname, prof] of profiles) {
  for (const [set, pages, qs] of [["", PAGES, ""], ["stress-", STRESS, "?data=stress"]]) {
    for (const [name, hash, opt = {}] of pages) {
      const file = `${set}${name}-${pname}`;
      if (FILTER && !file.includes(FILTER)) continue;
      const ctx = await browser.newContext(prof);
      if (!opt.empty) {
        await ctx.addInitScript(() => {
          try { if (!localStorage.getItem("nrc.watchlist")) localStorage.setItem("nrc.watchlist", JSON.stringify(["13468", "14047", "12359", "19019"])); } catch {}
        });
      }
      const page = await ctx.newPage();
      // Wowhead's icon server isn't reachable from every machine; placeholders show instead.
      await ctx.route("**/wow.zamimg.com/**", (r) => r.abort());
      page.on("console", (m) => {
        if ((m.type() === "error" || m.type() === "warning") && !/Failed to load resource/.test(m.text())) problems.push(`${file}: console ${m.type()}: ${m.text()}`);
      });
      page.on("requestfailed", (r) => { if (!r.url().includes("zamimg")) problems.push(`${file}: failed ${r.url()}`); });
      page.on("pageerror", (e) => problems.push(`${file}: ${e.message}`));
      page.on("response", (r) => {
        const u = r.url();
        if (r.status() >= 400 && !/\/history\/|\/daily\//.test(u)) problems.push(`${file}: ${r.status()} ${u}`);
      });
      await page.goto(BASE + qs + hash, { waitUntil: "networkidle" });
      if (opt.type) { await page.fill("#q", opt.type); await page.waitForTimeout(150); }
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`${file}: page scrolls sideways by ${overflow}px`);
      await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
      await ctx.close();
    }
  }
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no console errors, no unexpected 404s, no sideways scrolling");
