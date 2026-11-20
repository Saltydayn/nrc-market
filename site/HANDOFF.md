# NRC Market site: handoff (v1, 4 Nov 2026)

Static site, no build step: `cd site && python3 -m http.server 8000`, open `http://localhost:8000/`.
Stress test: `http://localhost:8000/?data=stress#/`. Tests: `node --test site/test/*.test.mjs`
(Node 22 won't take a bare directory). Screenshots: serve, then `node site/tools/screenshots.mjs` (needs Playwright).

## Owner decisions (Q&A, 4 Nov)
- **All UI text is English** (game terms: Market price, Supply, Trade Goods). German can come later.
- **Categories follow the in-game AH tree** (Weapons, Armor, … Trade Goods → Cloth/Herbs/…) in a left sidebar.
- **Extra pages:** Deals (buy out and relist) and Insights (rule-based signals with confidence and warnings).
- **Change ranges:** 6h, 24h, 3d, 5d, 7d, 10d, 14d, 30d, 60d, 90d, 180d, 360d, All. Lists, movers and the chart all use them.
- Font: Montserrat (OFL, variable, latin + latin-ext, `fonts/`). Phone works but got less polish than desktop.

## What's built
Shell (header search with `/` and Ctrl+K, freshness line with stale warnings, sidebar tree with counts, phone tab bar) ·
Overview (watchlist strip, risers/fallers, deals, most listed value, "worth a look" signals, a card per market) ·
Category (`#/c/trade-goods/herbs`, sortable table, filter, range, sort/filter/range in URL, category trend chart, "Show more" after 100 rows) ·
Item (`#/item/13468`, `#/item/15216:-12`: price, copy in game format, warnings, history chart with crosshair, keyboard and touch,
price steps, trend and 30-day projection, time-of-day pattern, variants, similar items, Wowhead link) ·
Movers · Deals · Insights · Watchlist (localStorage) · Search (`#/search?q=`).

## Files
`js/data.js` all fetching and caching · `js/clock.js` sample clock · `js/model.js` rows from latest+names, ladder, shard ·
`js/analysis.js` ranges, changes, movers filter, flip deals, trend fit, signals, hour profile, category index ·
`js/categories.js` the tree (one place to fix class/subclass numbers) · `js/format.js` money/percent/time ·
`js/search.js` · `js/store.js` localStorage wrapper · `js/ui/` chart, table, small bits, icons, search box · `js/views/` one per page.

## How data.js expects the data
- `DATA_BASE` constant (now `sample/out/`). Fetches use `credentials: "include"` for the later login cookie.
- Overview, category tables (6h/24h), search and movers (6h/24h) need only `latest.json` + `names.json`.
- **Ranges of 3 days or more read `daily/<YYYY-MM>.json`**: 1–2 files for ≤30d, more for longer. The overview loads the
  current daily file after first paint for its signals. The owner agreed to this. Cheaper later: have the hourly job
  write one small `summary.json` (per item: 7/30-day change, usual price, usual units, trend slope), then drop the daily
  loads from the list pages.
- `FIRST_MONTH` in data.js: oldest month a daily file can exist. Set it to the launch month for live data, so "All" doesn't probe empty months.
- Item chart: hourly history for ≤30 days (up to 31 parallel requests, drawn as they arrive), daily files beyond that. 404 = no data.
- Range changes for ≥3d compare the current median with the daily "median of hourly medians", like ch6/ch24 do.

## Decisions someone should check
- Flip deal = buy every listing priced ≥15 % under market price after the 5 % AH cut. Resale is p10 (conservative).
  Needs ≥10s profit and ≥3 listings. **The sample has no such listings**, so Deals is empty there; I tested it with a patched file.
- Signal thresholds (`findSignals`): steady trend R² ≥ 0.6 and ≥5 %/week. Cheap/pricey ±20/30 % vs 7-day median.
  Supply ±45/60 %. 30-day high/low ±5 %. Spike ±25 % in 24h. Same noise filter as movers.
- Confidence: days of history + listings + volatility. Projection = 14-day log-linear fit pushed to 30 days, always labelled.
- "Most listed value" skips items with fewer than 5 listings (one pricey listing isn't volume).
- Suffix gear: chart shows the cheapest variant; price steps merge all variants.

## Unsure / not verified
- **Item icons:** Wowhead's image server was blocked in the build environment, so every screenshot shows the letter
  placeholder. The image code is standard (lazy, fixed size, removed on error), but it hasn't been seen with real icons.
- Class/subclass numbers for Forever are still a guess.
- Time-of-day pattern needs ~7 days of hourly data to mean much; the page says so.

## Hosting (marketsite, 5 Nov)
- **Address:** https://naga-rave-cave.pages.dev/market/ — behind the guild site's Discord login. The guild site
  (repo naga-rave-cave, `lib/market.js` + `functions/market*.js`) checks the session, strips `/market` and passes the
  request to this Worker through the Pages service binding **`MARKET_SITE` → `nrc-market-site`** (set in the Pages dashboard).
  Not logged in: pages redirect to `/api/auth/login?next=/market/`, data answers 401 (site shows "Signed out").
- **Worker `nrc-market-site`:** `workers_dev = false`, so no public address; it trusts every request (only the guild site
  can reach it). `run_worker_first`: `/data/<file>` from the private R2 bucket (`out/` only, fixed list), everything else
  via `env.ASSETS`. Deployed by `.github/workflows/deploy-site.yml` on pushes to `main` touching `site/`.
- **Paths:** all site paths must stay relative (`data/`, `css/…`), because the site lives under `/market/`.
- **data.js:** live reads `data/`. Sample data on localhost or with `?data=sample`; `?data=live` forces live on localhost.
  `FIRST_MONTH` = 2026-11 for live. Empty states: no `latest.json` → "Waiting for the first scan"; 401 → "Signed out".
- **Local test of the whole path:** guild repo `bash dev/start.sh` (passes `--service MARKET_SITE=nrc-market-site`), then
  run `wrangler dev` on an assembled copy of `site/server` + files in `public/` (start.sh kills running workers, so start
  the market one after it). Log in at `localhost:8788/api/auth/login?next=/market/`.
- **Hourly kick:** GitHub's own schedule skips most hours, so this Worker's cron (`7 * * * *`) starts `hourly.yml` via
  `workflow_dispatch`. Needs the Worker secret `GH_DISPATCH_TOKEN` (fine-grained GitHub token, nrc-market only,
  Actions: read and write), set in the Cloudflare dashboard. Without it the cron just logs and does nothing.
- **TSM:** still only copied by the hourly job, not shown. TSM's Forever file is empty (5 Nov).

## Ideas not done
Estimated sales and cancellations (needs listing-level diffs), crafting margins (needs recipe data), TSM region values
next to ours, day-of-week pattern, German translation, a hidden-columns setting for the category table on mid-size screens.

## TSM (marketsite, 7 Nov)
- Joshua: keep our prices, add only what our scans can't give. No toggle.
- The hourly job writes `out/tsm.json` whenever TSM's Horde realm or EU region file changes (`jobs/tsm.py` → `site_file`):
  `{realmAt, regionAt, cols: [mv, min, recent, hist, sold, rate, avg, regionMv], items: {id: [...]}}`.
- Site (`model.js` parseTsm/addTsm): `row.sold` + `row.tsm` on our rows. "Sold/day" column in category, search and
  watchlist tables (Spread hides between 761–1600px to make room), "sells N/day" on deals, a "Sales" panel on the item page
  (with TSM's Horde price when our last scan of the item is over 6 h older than TSM's).
- Items only TSM has seen on the Horde AH: `market.tsmOnly`, in search and on a simple item page; never in lists,
  movers or deals. Names/icons for them come from the Wowhead backup like ours.
- Check TSM vs ours any time: Actions → "TSM check" (`jobs/tsm_compare.py`).

## Fixes round (marketsite, 20 Nov)
- **Freshness:** movers, risers/fallers, insights and "cheaper than usual" compare `seen` with `lastScanHour`
  (newest scan), not the clock. Before, every quiet 3 hours emptied them.
- **Changes = market price (p10)**, checked against the median: `agreedChange` (model.js) keeps a move only as far as
  both agree. Job sends `pc6`/`pc24` (p10) next to `ch6`/`ch24` (median) since 20 Nov. Items with < 5 listings
  (`MIN_LISTINGS`) show no % at all. Display caps at ">+999%".
- **Launch week out:** `TREND_FROM = "2026-11-08"` (data.js, live only) for trends, long-range changes, usual price.
- **Movers/signals:** no grey items, TSM sold ≥ 3/day (`MIN_SOLD`), jumps ≥ 5x or ≤ −80% are `isReset` (left out of
  movers, cheap/pricey and highs/lows; the spike signal names them as a likely buyout-and-relist). Ranked by
  |log change| × trade volume (`moveScore`), so busy markets come first.
- **Item page "Trend & usual range"** replaces the 30-day projection: today's p10 ± the 75th percentile daily move of
  the last 14 days (`usualRange`; backtest 20 Nov: 78% of next days inside). "Steady" trends need 14+ days and
  R² ≥ 0.7. Swing > 100% → "Too jumpy for a range". Daily chart line = p10.
- **Backtest:** `node site/tools/backtest.mjs daily-2026-11.json [--from 2026-11-08]` (download the daily file first).
  20 Nov (8–19 Nov, 6,149 items): stays 7.8%/10.8%, market drift halved 7.2%/10.7%, old log-linear 14%/22.9%.
- **Deals:** "Slow: about N days of EU sales" when a deal buys more than TSM's sold/day.
- **Hourly kick:** the site Worker's cron starts `hourly.yml` only when a scan arrived since the last run (lists
  `raw/scans/<day>/` for 3 days, compares with `out/_state.json` upload time) or the last run is ~3 h old.
