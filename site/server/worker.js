// The market site. It has no public address of its own (workers_dev = false): visitors reach it
// at naga-rave-cave.pages.dev/market/, where the guild site checks the Discord login and then
// passes the request on through a service binding. So everything that arrives here is a member.
//
// The Worker runs first for every request: /data/... comes from the private R2 bucket,
// everything else is one of the site's own files.
//
// It also starts the hourly market job on GitHub (see scheduled below), because GitHub's own
// timer skips most hours.

const FILES = /^(latest\.json|names\.json|tsm\.json|history\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{2}\.json|daily\/\d{4}-\d{2}\.json|tsmhist\/\d{4}-\d{2}\/[0-9a-f]{2}\.json)$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Method not allowed");
    if (!url.pathname.startsWith("/data/")) return env.ASSETS.fetch(req);

    const path = url.pathname.slice("/data/".length);
    if (!FILES.test(path)) return text(404, "Not found");

    const obj = await env.MARKET.get("out/" + path, { onlyIf: req.headers });
    if (!obj) return text(404, "Not found");
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheFor(path),
      etag: obj.httpEtag,
    });
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(req.method === "HEAD" ? null : obj.body, { headers });
  },

  // Cloudflare's cron (wrangler.toml) calls this every hour. Needs the secret GH_DISPATCH_TOKEN:
  // a GitHub token that may only start workflows in nrc-market.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (await jobNeeded(env.MARKET)) await startHourlyJob(env);
      else console.log("hourly job: no new scans since the last run, skipped");
    })());
  },
};

// Each run costs GitHub minutes (free: 2,000 a month, shared with the other private repos), and
// about 4 in 10 hourly runs found nothing new. So the job only starts when a scan arrived since the
// last run, or when the last run is ~3 hours old (TSM files, names and late uploads still get picked up).
// Costs 1 read + up to 3 bucket listings per hour.
const FORCE_AFTER_MS = (3 * 60 - 15) * 60 * 1000;
export async function jobNeeded(bucket, nowMs = Date.now()) {
  if (!bucket) return true;
  try {
    const state = await bucket.head("out/_state.json");      // the job rewrites this on every run
    if (!state || !state.uploaded) return true;
    const last = new Date(state.uploaded).getTime();
    if (nowMs - last >= FORCE_AFTER_MS) return true;
    for (let back = 0; back < 3; back++) {                  // uploads are filed by the day they were scanned
      const day = new Date(nowMs - back * 86400000).toISOString().slice(0, 10);
      let cursor;
      do {
        const page = await bucket.list({ prefix: `raw/scans/${day}/`, cursor, limit: 1000 });
        if (page.objects.some((o) => new Date(o.uploaded).getTime() > last)) return true;
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    return false;
  } catch (e) {
    console.log("hourly job: check failed, starting anyway", String(e));
    return true;
  }
}

export async function startHourlyJob(env, fetcher = fetch) {
  if (!env.GH_DISPATCH_TOKEN) {
    console.log("hourly job: no GH_DISPATCH_TOKEN set, nothing started");
    return 0;
  }
  const res = await fetcher(HOURLY_JOB, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "nrc-market-site",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  // 204 = started. Anything else ends up in the Worker's logs.
  if (res.status !== 204) console.log("hourly job: GitHub answered", res.status, await res.text());
  return res.status;
}

const HOURLY_JOB = "https://api.github.com/repos/Saltydayn/nrc-market/actions/workflows/hourly.yml/dispatches";

// latest/names change hourly. Past days of history never change again.
function cacheFor(path) {
  if (path.startsWith("history/")) {
    const day = path.slice(8, 18);
    const today = new Date().toISOString().slice(0, 10);
    return day < today ? "private, max-age=86400" : "private, max-age=600";
  }
  if (path.startsWith("daily/")) return "private, max-age=1800";
  return "private, max-age=300";
}

function text(status, body) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
