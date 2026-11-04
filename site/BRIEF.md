# NRC Market website: build brief

You're building the first full version of a small, private auction-house price website for a World of Warcraft
guild. This file is everything you need. Read it fully before writing code.

## 1. What this is
- **The game:** *WoW: Forever*, a new official Blizzard server type (Classic-era items, a modern client with the
  retail-style auction house). We play on **EU, PvE, Horde**. One auction house per faction, 1M+ listings possible.
- **The guild:** *Naga Rave Cave* (NRC), German. Members run our addon, which reads the full auction house in the
  background. A small desktop app uploads those scans every hour. An hourly job merges them into ready-made
  JSON files. **This website only displays those files. It never calculates heavy things and never asks a server.**
- **Who uses it:** ~20–100 guild members, desktop and phone. Members only. Login comes later, not your job.
- **All text members see is German, except item names: those are English** (decided by the owner; German item names
  are not used). Code, comments and docs are English. Comments should read like a person wrote
  them: short, only where something isn't obvious.
- **The owner** doesn't read code. He judges the product by looking at it. It has to look designed, calm and
  polished, not like a template or a generic AI site (section 8).

## 2. Your job and its limits
- Work in the repo **Saltydayn/nrc-market**, branch **`site-v1`**. Push only to `site-v1`. Never push to `main`.
- Change only the **`site/`** folder. Don't touch `worker/`, `jobs/`, `config/`, `.github/`, the root
  `package.json` or `CLAUDE.md`. The root `CLAUDE.md` mentions an "HQ" repo and a protocol. **Ignore it for this job.**
  Don't attach, clone or edit any other repo.
- **Out of scope:** login, any backend or data API, deploying, Cloudflare config, `site/functions/` (reserved for
  the data/login layer that comes later). Also out: anything that needs weeks of data (estimated sales, best-time-to-sell
  heatmaps, investment picks), recipe profits, Black Market prices, a "launch playbook".
- No secrets anywhere. You don't need any.
- Build everything in section 6 that you can do well. Order: section 6 top to bottom. A finished, polished smaller
  set beats a big half-done one. If time is left, see section 11.
- **Reference:** you may open `https://bootybaybroker.com` (a public WoW price site) for ideas on **features and
  layout only**. Don't copy its look, wording or code, and never take data from it.

## 3. Tech
- **Static site, no build step, no framework, no runtime npm packages.** Plain HTML + CSS + JavaScript (ES modules).
  It must run with `cd site && python3 -m http.server 8000` and open at `http://localhost:8000/`.
- **Hash routing** (`#/`, `#/k/kraeuter`, `#/item/13468`, `#/bewegungen`, `#/merkliste`, `#/suche?q=lotus`), so any
  static host works without rewrite rules. Back/forward buttons and reload must keep the view.
- **Charts:** hand-made SVG. No chart library.
- **Fonts:** at most two families, **self-hosted** as woff2 in `site/fonts/` (OFL-licensed, include the licence file).
  No Google Fonts or other font CDNs. German privacy law makes hotlinking them a problem.
- **Only outside request allowed:** item icons from Wowhead's image server (section 5).
- **Suggested layout** (change it if you have a better reason):
  ```
  site/index.html          shell
  site/css/                tokens.css (colors, spacing, type), base.css, components.css
  site/js/app.js           router + boot
  site/js/data.js          ALL data loading goes through here (section 4)
  site/js/format.js        money, numbers, times (section 7)
  site/js/categories.js    category mapping (section 5)
  site/js/views/*.js       one file per page
  site/js/ui/*.js          small parts: money, change badge, sparkline, chart, item row, icon
  site/test/*.test.mjs     node --test, pure functions only
  site/sample/             sample data (already there, see section 4)
  site/tools/make_sample.py  regenerates the sample (don't edit unless the sample is broken)
  ```
- **Browser storage:** `localStorage` only for small per-person things (favourites, last range picked). Always wrap
  in try/catch. The site must work fine if storage throws.

## 4. The data
All prices are **copper per unit**, whole numbers. 1 gold = 100 silver = 10,000 copper.
All times are **unix seconds, UTC**. Hour values are hour starts.

### Where it comes from
`js/data.js` reads from one base path, a constant at the top: `DATA_BASE = "sample/out/"`. Later it becomes a URL on
our own server and needs a login cookie, so **put every fetch in data.js**, nowhere else. Load each file once and keep
it in memory. Every file is a request we pay for in free-tier quota, so:
- The **overview, category pages, search, movers and favourites must need only `latest.json` + `names.json`** (2 requests).
- History files only on the item page, only for the range shown.
- `?data=stress` in the URL loads `sample/stress/latest.json` instead (15,000 extra unnamed items, no history) to
  test speed. Everything must stay smooth with it.

### `latest.json`: current state of every item seen in the last 2 days
```json
{
  "updated": 1793821800,          // when the job wrote this file
  "scans24h": 58,                 // scans merged in the last 24 h
  "contributors24h": 7,           // different members who scanned in the last 24 h
  "lastScanHour": 1793818800,     // hour start of the newest scan
  "items": {
    "2589": {
      "min": 42,                  // cheapest unit price
      "p10": 42,                  // price at 10 % of all listed units (cheap end, ignores single odd listings)
      "med": 46,                  // price at 50 % of all listed units
      "units": 4961,              // total quantity listed
      "listings": 56,             // number of auctions
      "seen": 1793818800,         // hour this item was last seen
      "ch6": -0.1636,             // price change vs ~6 h before "seen" (fraction, -0.16 = -16 %), can be null
      "ch24": -0.08,              // same vs ~24 h before, can be null
      "ladder": "42*1049;43*914;44*218;...",  // up to 10 cheapest price steps "price*units", only if listings > 1
      "spark": [40, 41, null, ...]            // 24 hourly p10 values, oldest first, null = not seen that hour
    },
    "15216:-12": { ... }          // key "itemID:suffixID" = random-suffix gear ("Rune Sword of the Bear")
  }
}
```
- `spark` exists in the sample only. The live file gets it soon. Code must not break if it's missing (no sparkline then).
- `ch6`/`ch24` are measured on the median today. Show them as "price change" anyway. The backend will switch them
  to p10 later.
- Items not seen for 2 days drop out of the file.

### `names.json`: item info, keyed by plain item ID (no suffix)
```json
{ "2589": { "de": "Leinenstoff", "en": "Linen Cloth", "q": 1, "cls": 7, "sub": 5, "ilvl": 5, "req": 0,
            "stack": 200, "icon": "inv_fabric_linen_01" } }
```
- `q` quality 0–5 · `cls`/`sub` item class/subclass (section 5) · `ilvl` item level · `req` required level ·
  `stack` max stack.
- **Show only `en` as the item name.** Ignore `de` (the sample still has it; the live file may too). No `en`, or no
  entry at all (items `19019`/`21877` in the sample): show "Unbekannter Gegenstand #19019" with a neutral icon.
  Such items still appear in search by ID and on movers.
- `icon` is optional (only the sample has it today). No icon → neutral placeholder.

### `history/<YYYY-MM-DD>/<shard>.json`: hourly history, one folder per UTC day
- `shard` = `(itemID % 64)` as two lowercase hex digits (`2589 % 64 = 29` → `"1d"`). For `"15216:-12"` use `15216`.
- Content: `{ "<key>": { "<hour unix>": [min, p10, med, units, listings], ... }, ... }`.
- Days with no scans have no folder; a missing file = no data (404 is normal, not an error).
- Kept 30 days. The sample covers 2026-10-25 to 2026-11-04.

### `daily/<YYYY-MM>.json`: one value per day, kept forever
`{ "<key>": { "2026-11-03": [lowest min, median of hourly medians, median units], ... } }`.
One file per month holds **all** items, so it's big. Load it only for the long ranges on the item page.

### Sample mode clock
The sample ends on 2026-11-04 19:00 UTC. So it never looks stale on later days, **"now" in sample mode =
`latest.updated` + 10 minutes**. Keep that in one place (`data.js` or a tiny `clock.js`). On the live site, now = real time.

## 5. Categories, quality, icons

### Categories (front page order). Map by `cls`/`sub` from names.json
| Slug | German label | Rule |
|---|---|---|
| `stoffe` | Stoffe | cls 7, sub 5 |
| `leder` | Leder | cls 7, sub 6 |
| `kraeuter` | Kräuter | cls 7, sub 9 |
| `erze` | Erze & Steine | cls 7, sub 7 |
| `verzauberkunst` | Verzauberkunst | cls 7, sub 12 |
| `elementar` | Elementar | cls 7, sub 10 |
| `kochen` | Kochzutaten | cls 7, sub 8 |
| `traenke` | Tränke & Elixiere | cls 0, sub 1, 2, 3 |
| `verbrauch` | Essen & Verbände | cls 0, sub 5, 7 |
| `taschen` | Taschen | cls 1 |
| `rezepte` | Rezepte | cls 9 |
| `ausruestung` | Ausrüstung | cls 2, 4 |
| `sonstiges` | Sonstiges | everything else with a name (cls 0 sub 8, 6 projectiles, 15 misc, other trade goods …) |

Unnamed items have no category: not on the front page, but in search, movers and favourites. Keep the mapping in one
file (`categories.js`) so it can change in one place. The class numbers are a best guess until launch.

### Quality colours (item names only)
0 poor `#9d9d9d` · 1 common: use the normal text colour, not pure white · 2 uncommon `#1eff00` · 3 rare `#0070dd` ·
4 epic `#a335ee` · 5 legendary `#ff8000`. On a dark background, lighten rare/epic slightly if contrast is too low
(WCAG AA for text), but keep them clearly recognisable.

### Icons
`https://wow.zamimg.com/images/wow/icons/<size>/<icon>.jpg`, sizes `small` (18 px), `medium` (36 px),
`large` (56 px). Lazy-load, fixed size (no layout shift), small radius and a 1 px dark border like the game.
Missing icon or failed load → neutral placeholder.
On the item page, add a small external link "Auf Wowhead ansehen" to `https://www.wowhead.com/classic/item=<id>`,
with a hint that Forever items can differ.

### Random-suffix gear
Keys like `15216:-12`. Suffix names are unknown. In lists and search, show the base item **once**, with the cheapest
variant's price and the total listings. On the item page, show a "Varianten" table (one row per suffix:
"Variante −12", price, quantity, last seen). Route: `#/item/15216`, optionally `#/item/15216:-12` to focus one.

## 6. Pages and features (build in this order)

### 6.1 Shell (every page)
- **Header:** name **"NRC Market"** (a constant, easy to rename), the search field (focus with `/` or `Ctrl+K`), and
  a freshness line: **"Stand 20:10 · 58 Scans in 24 Std. · 7 Scanner"**. If `lastScanHour` is older than 3 h, add a quiet
  warning: "Letzter Scan vor 5 Std. Preise können veraltet sein". Older than 12 h: stronger, still not alarming.
- **Nav:** Übersicht · Bewegungen · Merkliste. Active page marked. On phone: compact, no hamburger maze. 3 items fit.
- **Footer:** one quiet line: "Preise aus den Auktionshaus-Scans unserer Gildenmitglieder. EU · PvE · Horde".
  In sample mode, also a small visible "Beispieldaten" marker (in the header too, so no one mistakes it for real).

### 6.2 Übersicht (front page) `#/`
- Favourites first (if any): a compact strip of pinned items with price + 24 h change.
- Then **one section per category** (table above), each a clean block showing ~6–8 representative items:
  the most-listed ones (`listings`), each with icon, name, **Marktpreis** (`p10`), 24 h change, sparkline (if `spark`).
  A link to the full category ("Alle 22 anzeigen").
- Optional, if it fits the design: a small "Größte Bewegungen" teaser (3 up, 3 down) linking to the movers page.
- No walls of numbers. The front page shows the baseline at a glance; detail is one click away.

### 6.3 Kategorie `#/k/<slug>`
Full sortable table of all items in the category. Columns: Gegenstand · Marktpreis (p10) · Ab (min) · Median · Menge
(units) · Angebote (listings) · 6 Std. · 24 Std. · Zuletzt gesehen. Default sort: Angebote, descending. Click a header to
sort, click again to flip. A filter field inside the category. Row click → item page. Sort + filter in the URL
(`#/k/kraeuter?sort=p10&dir=asc`). Keep big lists fast: render at most ~100 rows, then "Mehr anzeigen", or simple
windowing. On phone, rows become two-line list items (name + price on top, change + quantity below), not a sideways
scrolling table.

### 6.4 Suche
- Instant dropdown while typing: English item name or item ID. Case- and punctuation-tolerant ("khadgars" finds
  "Khadgar's Whisker", "flask titans" finds "Flask of the Titans": all words must match, any order).
  Ranking: starts-with before contains, then by listings.
  Up to ~8 results with icon, name, price. Keyboard: arrows, Enter, Esc.
- Enter without picking → full results page `#/suche?q=…` (same row design as the category table).
- Build the index once after loading. It must stay instant with the stress file.

### 6.5 Item page `#/item/<id>`
- **Head:** large icon, name in quality colour, category · Stufe (ilvl) · "Benötigt Stufe X" if `req` > 0 · max stack.
  Merken/Gemerkt toggle (star or similar, not an emoji).
- **Now:** Marktpreis (big), Ab, Median, Menge, Angebote, 6 Std./24 Std. change, "zuletzt gesehen vor 2 Std.".
  If not seen in the newest scan hour, say so plainly.
- **Preisstufen (ladder):** horizontal bars, one per price step: price on the left, units as bar length, units number.
  Cumulative units as a faint second value ("bis hier: 2.181"). Explain in one quiet line what it shows.
  Needs `ladder`; for single listings show just that one.
- **Verlauf (history chart):** ranges **24 Std. · 7 Tage · 30 Tage · Alles**. Default 7 Tage.
  Hourly data (history files) for ≤ 30 days, daily files for "Alles". Lines: Marktpreis (p10) and Median, plus quantity
  as soft bars on a second scale below or behind. Hover/tap shows a crosshair with date/time (Berlin time), prices,
  quantity. Gaps (hours without data) stay gaps, don't draw through them. A single far-off hour (the sample has
  outliers) must not squash the whole chart: scale the y-axis to the 2nd–98th percentile and clip the rest
  with a marker. Loading 30 days = 30 small files. Load them in parallel, show the chart as soon as the first ones arrive.
- **Varianten** table for suffix gear (section 5).
- **Wowhead** link (section 5).
- Unknown item ID → friendly "Diesen Gegenstand haben wir in den letzten 2 Tagen nicht gesehen." + search field.

### 6.6 Bewegungen `#/bewegungen`
Biggest risers and fallers. Toggle **6 Std. / 24 Std.**. Only items with `listings` ≥ 5, `med` ≥ 100 (1 silver) and
seen within the last 3 h, so noise doesn't win. Two lists side by side (stacked on phone): "Gestiegen" / "Gefallen",
top 15 each, with change, price now, and sparkline. Category filter chips.

### 6.7 Merkliste `#/merkliste`
Favourites from localStorage (item keys). Same rows as the category table. Empty state with one sentence on how to add
items (from the item page). Remove from the list right there.

### 6.8 States and edge cases (all pages)
- Loading: quiet placeholders with fixed sizes, no shimmer animation, no spinner walls.
- Data failed to load: one calm message + "Erneut versuchen".
- Missing names, missing icons, missing `ch`, missing `ladder`, missing `spark`, items with 1 unit,
  very large prices (999,999 g), very small (1 c). All must look right.
- Nothing must jump while icons load.

### 6.9 Phone
Everything usable at 375 px wide. Tap targets ≥ 40 px. No horizontal scrolling of the page. Chart readable and
touch-scrubbable.

## 7. Formatting (German)
- **Money:** gold / silver / copper as numbers with small coin marks (CSS circles in gold `#d6a738`-ish,
  silver `#b8bcc4`-ish, copper `#b8733d`-ish; tune to the palette). Drop leading zero parts: `46c`, `4s 20c`, `52g 3s`.
  Above 100 g you may drop copper; above 10,000 g also silver. Thousands in gold with a dot: `1.234g`.
  Accessible text: "52 Gold 3 Silber". (German client letters are g/s/k. Using coin marks avoids the question.)
- **Numbers:** German: `4.961`, `12,5 %`. Percent with sign and a thin space: `+12,5 %`, `−8 %` (real minus sign).
  Small changes (< 0.5 %) show as `±0 %`, neutral colour.
- **Up/down colours:** muted green / muted red, never neon. Never rely on colour alone (sign or arrow too).
- **Times:** Europe/Berlin. Relative: "gerade eben", "vor 23 Min.", "vor 2 Std.", "gestern 18:00", then "3. Nov., 14:00".
- **Words to use** (keep them consistent): Marktpreis · Ab · Median · Menge · Angebote · Zuletzt gesehen ·
  Preisstufen · Verlauf · Varianten · Merken / Gemerkt · Merkliste · Bewegungen · Gestiegen / Gefallen · Suche ·
  "Keine Treffer" · "Alle … anzeigen" · "Mehr anzeigen" · Beispieldaten. Use "Gegenstand", not "Item", in the UI.

## 8. Look and feel
**Direction: a calm, dark trading ledger.** Numbers first, like a well-made finance tool or a good terminal, with a
little warmth from the game: the coin colours and item quality colours are the only strong colours on the page.
- Background: deep, slightly warm dark (not pure black, not the default blue-slate). Two or three surface steps,
  separated by subtle borders more than by shadows.
- One accent colour, used sparingly (links, focus, active nav). A muted gold fits.
- Type: one clean sans for UI, **tabular numbers everywhere prices appear** (`font-variant-numeric: tabular-nums`),
  right-aligned price columns. Clear size hierarchy, not everything 14 px.
- Spacing: one scale (e.g. 4/8/12/16/24/32/48) and stick to it. Generous but not empty.
- Motion: almost none. Short fades on hover/route change at most. Respect `prefers-reduced-motion`.
- Visible keyboard focus everywhere.

**Hard don'ts** (these make a site look generated): purple/blue gradients, glowing elements, gradient text,
glassmorphism, emoji as icons or labels, "✨ New" badges, pulsing dots, tiny uppercase letter-spaced labels on every
section, random rounded-pill everything, big hero banners, stock illustrations, filler marketing copy
("Dein ultimativer Marktbegleiter!"). Every word on the page should earn its place. Simple line icons (inline SVG,
one consistent set, drawn or from an MIT/ISC set copied in) only where they help.

## 9. Testing (do it, don't skip)
- `node --test site/test/` covers the pure parts: money format (1 c, 99 c, 1 s, 1 g 0 s 1 c, 1.234 g, 999.999 g),
  percent format, relative times, category mapping, ladder parsing, suffix grouping, shard name, movers filter,
  search normalisation (case, apostrophes, multi-word).
- **Look at your work:** serve the site and take Playwright screenshots of every page at **1440×900** and on an
  **iPhone 13** profile, normal and with `?data=stress`. Open the screenshots and check them like a picky designer:
  alignment, spacing, contrast, overflow, truncated names (long names exist: "Formula: Enchant Bracer - Superior
  Stamina"). Fix and repeat until they're right. Save the final set (1× scale, PNG) in `site/screenshots/`.
- Check the browser console: no errors, no 404s other than expected missing history files.
- Keyboard-only pass: search, sort, open item, switch ranges, toggle favourite.

## 10. When you're done
1. `site/HANDOFF.md` (max ~60 lines, English): what's built, file map, how data.js expects the data, anything
   unfinished or unsure, decisions you made that someone should check, ideas you didn't get to.
2. Commit in small steps with clear messages starting with `[marketsite]`, and push to `site-v1`.
3. Finish with a short plain-language summary (no code) for the owner: what he can look at and how.

## 11. If time is left (in this order)
1. Item page: "Ähnliche Gegenstände" (same category, nearby price) as a small list.
2. Category page: a compact "Preisspanne" mini-bar per row (min → median).
3. Overview: per category, a one-line summary ("12 Gegenstände · Ø 24 Std. +3 %").
4. Copy-to-clipboard of an item's Marktpreis in game format (`52g 3s 0c`).
Don't add anything beyond this list.
