// The market site. Cloudflare serves the site's own files before this code runs, so it only
// sees /data/... (the market files from the private R2 bucket) and paths that don't exist.

const FILES = /^(latest\.json|names\.json|history\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{2}\.json|daily\/\d{4}-\d{2}\.json)$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/data/")) return text(404, "Not found");
    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Method not allowed");

    const path = url.pathname.slice("/data/".length);
    if (!FILES.test(path)) return text(404, "Not found");
    const key = "out/" + path;

    // Members only, unless DATA_ACCESS is "public". "No data yet" is no secret, so a missing
    // file answers 404 either way and the site can show its waiting state.
    if (env.DATA_ACCESS !== "public" && !(await signedIn(req, env))) {
      const head = await env.MARKET.head(key);
      return head ? text(401, "Sign in first") : text(404, "Not found");
    }

    const obj = await env.MARKET.get(key, { onlyIf: req.headers });
    if (!obj) return text(404, "Not found");
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheFor(path),
      etag: obj.httpEtag,
    });
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(req.method === "HEAD" ? null : obj.body, { headers });
  },
};

// Discord sign-in comes next; until then nobody counts as signed in.
async function signedIn() {
  return false;
}

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
