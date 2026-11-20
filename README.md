# nrc-market

Auction house prices for Naga Rave Cave (WoW: Forever, EU · PvE · Horde).

**How the data moves:** GuildKit reads the auction house in game → NRC Sync uploads each scan →
the intake service checks it and stores it in Cloudflare R2 → once an hour a GitHub job merges everything
into price history and a "current prices" file → the market website (later) shows it.
Next to that, the same hourly job copies TSM's public price files, so we build our own TSM history too.

## One-time setup (Joshua)
Nothing here costs money at our size. The code itself stops before the free limits.

1. **Cloudflare → R2:** turn R2 on (it may ask for a payment method), then *Create bucket* named `nrc-market`.
2. **Cloudflare → Billing → Billable Usage → Create budget alert:** $1. You get an email if anything ever costs money.
3. **Cloudflare → R2 → Manage API tokens → Create Account API token:** permission *Object Read & Write*,
   only bucket `nrc-market`, no expiry. It shows an *Access Key ID* and a *Secret Access Key* once.
4. **Cloudflare → My Profile → API Tokens → Create Token:** template *Edit Cloudflare Workers*. Leave the
   permission list as it is. *Account Resources:* Include → your account. *Zone Resources:* Include → All zones.
   Expiry and IP filter: leave empty. Continue → Create → copy the token.
5. **GitHub → this repo → Settings → Secrets and variables → Actions → New repository secret**, four times:
   - `CLOUDFLARE_ACCOUNT_ID` (Cloudflare dashboard, right side of the account home page)
   - `CLOUDFLARE_API_TOKEN` (from step 4)
   - `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (from step 3)
6. **GitHub → Actions:** run *Deploy intake worker* once, then *Hourly market job* once. Both should go green.

Never paste these values into a chat or a file.

## Cost guards
- NRC Sync sends **once an hour** (all new scans in one request, max 4), only when there's something new.
- Intake: max 3 requests per install per hour, 4,000 per day for everyone, max 8 scans kept per hour of the day
  (more add nothing), 5 new install keys per internet address per day, 300,000 storage writes per month (R2 free: 1,000,000).
- In game, guildies announce finished scans, so the guild asks for a full scan only about every 20 minutes.
- Hourly job: max 800 writes per run (~580,000 a month at worst; normal runs use far fewer).
- Uploads are deleted after 30 days; the hourly history keeps 30 days, daily summaries stay.
  Worst case (8 scans every hour, all day): ~2–3 GB of the 10 GB free storage.
- GitHub Actions: ~720 of the 2,000 free minutes per month (shared with your other private repos). If that gets
  tight, change the schedule in `.github/workflows/hourly.yml` to every 2 hours.

## Files in the bucket
`raw/` uploads · `tsm/` TSM copies · `out/latest.json`, `out/history/`, `out/daily/`, `out/names.json`,
`out/tsm_status.json` (which TSM files exist; shows when Forever appears) · `limits/` counters · `keys/` upload keys (hashed).
