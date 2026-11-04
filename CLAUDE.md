# nrc-market — brief for Claude

Auction house data for Naga Rave Cave (WoW: Forever, EU · PvE · Horde): intake Worker, R2 storage, hourly job,
later the analytics website. Owner chat: **NRC · Economy** (inbox `economy`). Joshua does not read code.

## HQ first
Pull `Saltydayn/nrc-hq` (as `hq`) and follow `hq/PROTOCOL.md`. Concept: `hq/design/economy.md`.
Data format: `hq/specs/2026-11-02-market-data-format.md` (change it only with sync + guildkit in the loop).

## Parts
| Folder | What | Runs on |
|---|---|---|
| `worker/` | Intake: `POST /v1/register`, `/v1/scans`, `/v1/names`, `GET /v1/health`. Checks key, shape, limits; files uploads in R2. | Cloudflare Worker `nrc-market` |
| `jobs/` | Hourly: copy TSM files (`tsm.py`), merge scans into history + `out/latest.json` (`process.py`). | GitHub Actions (`hourly.yml`) |
| `config/tsm.json` | Which TSM files to copy / probe. | |
| `site/` | Market website (owner chat: NRC · Market Site, inbox `marketsite`). Static files + `site/server/worker.js` (serves `/data/` from R2, members only). Read `site/HANDOFF.md` first. | Cloudflare Worker `nrc-market-site` (`deploy-site.yml`) |

## Rules
- Free tier only. R2 writes are capped in code (Worker: `MONTHLY_WRITE_CAP`; job: `MAX_WRITES_PER_RUN`). Keep it that way.
- No secrets in the repo. Secrets live in GitHub (Actions) and Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Upload keys: no login (Joshua, 2 Nov). Each NRC Sync install registers once and gets its own key; stored only as SHA-256 hashes (`keys/<hash>.json`). Revoke = set `revoked: true`. Guild filter: `ALLOWED_GUILDS` in wrangler.toml.
- Prices only from the game (our scans) and TSM's official public files. Never scraped (HQ DECISIONS 24 Oct).
- Tests before every push: `npm test` (Worker) and `python -m pytest jobs`.
- Code, comments and docs English. The market site's UI is **English** too (Joshua, 4 Nov), and item names are English only; German-client scans are discarded (HQ DECISIONS 4 Nov).
