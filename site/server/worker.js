// The market site. It has no public address of its own (workers_dev = false): visitors reach it
// at naga-rave-cave.pages.dev/market/, where the guild site checks the Discord login and then
// passes the request on through a service binding. So everything that arrives here is a member.
//
// The Worker runs first for every request: /data/... comes from the private R2 bucket,
// everything else is one of the site's own files.

const FILES = /^(latest\.json|names\.json|history\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{2}\.json|daily\/\d{4}-\d{2}\.json)$/;

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
};

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
