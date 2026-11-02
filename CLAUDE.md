# nrc-market — brief for Claude

Auction house data for Naga Rave Cave (WoW: Forever, EU · PvE · Horde): intake Worker, R2 storage, hourly job,
later the analytics website. Owner chat: **NRC · Economy** (inbox `economy`). Joshua does not read code.

## HQ first
Pull `Saltydayn/nrc-hq` (as `hq`) and follow `hq/PROTOCOL.md`. Concept: `hq/design/economy.md`.
Data format: `hq/specs/2026-11-02-market-data-format.md` (change it only with sync + guildkit in the loop).

## Parts
| Folder | What | Runs on |
|---|---|---|
| `worker/` | Intake: `POST /v1/scan`, `/v1/names`, `GET /v1/health`. Checks key, shape, limits; files uploads in R2. | Cloudflare Worker `nrc-market` |
| `jobs/` | Hourly: copy TSM files (`tsm.py`), merge scans into history + `out/latest.json` (`process.py`). | GitHub Actions (`hourly.yml`) |
| `config/tsm.json` | Which TSM files to copy / probe. | |

## Rules
- Free tier only. R2 writes are capped in code (Worker: `MONTHLY_WRITE_CAP`; job: `MAX_WRITES_PER_RUN`). Keep it that way.
- No secrets in the repo. Secrets live in GitHub (Actions) and Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Upload keys are stored only as SHA-256 hashes (`keys/<hash>.json` in R2). Issuing them comes with the app login (sync v2).
- Prices only from the game (our scans) and TSM's official public files. Never scraped (HQ DECISIONS 24 Oct).
- Tests before every push: `npm test` (Worker) and `python -m pytest jobs`.
- Member-facing text is German; code, comments and docs English.
