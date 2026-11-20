// nrc-market intake: takes auction scans from NRC Sync and files them in R2.
// Format: hq specs/2026-11-02-market-data-format.md. No database: keys, counters and dedupe are small R2 objects.
//
//   POST /v1/register  NRC Sync gets its own upload key on first start (no login; a few per IP per day)
//   POST /v1/scans     up to 4 scans in one request (NRC Sync sends once an hour), Authorization: Bearer <key>
//   POST /v1/names     item names for one client language
//   GET  /v1/prices    in-game price file for GuildKit's tooltip (install key), see out/ingame.txt
//   GET  /v1/health    quick check
//
// R2 layout:
//   keys/<sha256 of key>.json            { member, created, revoked }
//   raw/scans/<YYYY-MM-DD>/<HH>/<id>.json.gz { received, member, app, scan }
//   raw/names/enUS/<member>-<YYYY-MM-DD>-<HHMMSS>.json.gz   (one file per upload, never overwritten)
//   limits/<YYYY-MM-DD>.json             requests today (everyone)      -> daily cap
//   limits/<YYYY-MM>.json                writes this month              -> monthly cap
//   limits/key/<hash>/<YYYYMMDDHH>.json  requests by one key this hour  -> per-key limit
//   limits/slot/<YYYYMMDDHH>.json        scans stored for that scan hour -> enough is enough
//   limits/ip/<hash>/<YYYY-MM-DD>.json   keys handed out to one address today

const SCANS_FORMAT = "nrc-market-scans/1";
const MAX_SCANS = 4;
const NAMES_FORMAT = "nrc-market-names/1";
const MAX_BODY = 8 * 1024 * 1024;          // compressed
const MAX_JSON = 24 * 1024 * 1024;         // after unpacking
const MAX_AGE = 30 * 24 * 3600;            // archive uploads after sync v2 arrives may be a few weeks old
const LINE = /^[0-9]+(:-?[0-9]+)?,\d+,\d+,\d+,\d+,\d+(,(\d+\*\d+)(;\d+\*\d+)*)?$/;
const SCAN_ID = /^[0-9a-zA-Z]{4,32}-\d{9,11}$/;
const LOCALE = "enUS";                     // English clients only (Joshua, 4 Nov); others are taken but not kept

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

function cfg(env) {
  const list = (v, d) => String(v ?? d).split(",").map((s) => s.trim()).filter(Boolean);
  return {
    regions: list(env.ALLOWED_REGIONS, "EU"),
    factions: list(env.ALLOWED_FACTIONS, "Horde"),
    guilds: list(env.ALLOWED_GUILDS, ""),                    // empty = any guild
    perKeyHour: Number(env.PER_KEY_PER_HOUR ?? 3),
    perSlot: Number(env.SCANS_PER_HOUR ?? 8),
    keysPerIp: Number(env.KEYS_PER_IP_PER_DAY ?? 5),
    dailyCap: Number(env.DAILY_UPLOAD_CAP ?? 4000),
    monthlyWrites: Number(env.MONTHLY_WRITE_CAP ?? 300000),   // R2 free tier: 1M writes/month
  };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function readBody(request) {
  const size = Number(request.headers.get("content-length") || 0);
  if (size > MAX_BODY) return { error: 413 };
  let stream = request.body;
  if (!stream) return { error: 400 };
  if ((request.headers.get("content-encoding") || "").includes("gzip")) {
    stream = stream.pipeThrough(new DecompressionStream("gzip"));
  }
  const text = await new Response(stream).text().catch(() => null);
  if (text === null) return { error: 400 };
  if (text.length > MAX_JSON) return { error: 413 };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: 400 };
  }
}

async function getJson(env, key) {
  const obj = await env.BUCKET.get(key);
  return obj ? obj.json() : null;
}

async function bump(env, key, by = 1) {
  const cur = (await getJson(env, key)) || { n: 0 };
  cur.n += by;
  await env.BUCKET.put(key, JSON.stringify(cur));
  return cur.n;
}

const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const clock = (t) => new Date(t * 1000).toISOString().slice(11, 19).replace(/:/g, "");
const hour = (t) => new Date(t * 1000).toISOString().slice(0, 13).replace(/[-T]/g, "");

// Checks one scan. Returns null when fine, else a short reason.
export function checkScan(s, c, now) {
  if (!s || typeof s !== "object") return "no scan";
  if (typeof s.id !== "string" || !SCAN_ID.test(s.id)) return "bad id";
  for (const f of ["t", "n", "read", "items", "dur"]) {
    if (!Number.isInteger(s[f]) || s[f] < 0) return `bad ${f}`;
  }
  if (typeof s.cov !== "number" || s.cov < 0 || s.cov > 1) return "bad cov";
  if (s.t > now + 600 || s.t < now - MAX_AGE) return "bad time";
  if (!c.regions.includes(s.region)) return "region";
  if (!c.factions.includes(s.faction)) return "faction";
  if (c.guilds && c.guilds.length && !c.guilds.includes(s.guild)) return "guild";
  if (typeof s.data !== "string" || s.data.length === 0) return "no data";
  const lines = s.data.split("\n");
  if (lines.length !== s.items) return "item count";
  const step = Math.max(1, Math.floor(lines.length / 50));     // spot-check ~50 lines across the file
  for (let i = 0; i < lines.length; i += step) {
    if (!LINE.test(lines[i])) return `bad line ${i + 1}`;
  }
  return null;
}

async function member(env, request) {
  const auth = request.headers.get("authorization") || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (key.length < 24) return null;
  const hash = await sha256(key);
  const rec = await getJson(env, `keys/${hash}.json`);
  if (!rec || rec.revoked) return null;
  return { hash, name: rec.member };
}

// shared limits: per key per hour, everyone per day, writes per month
async function overLimit(env, c, who, now, writes) {
  const k = `limits/key/${who.hash}/${hour(now)}.json`;
  const mine = (await getJson(env, k))?.n || 0;
  if (mine >= c.perKeyHour) return json(429, { error: "slow down" }, { "retry-after": "900" });
  const today = (await getJson(env, `limits/${day(now)}.json`))?.n || 0;
  if (today >= c.dailyCap) return json(503, { error: "daily cap" }, { "retry-after": "21600" });
  const month = (await getJson(env, `limits/${day(now).slice(0, 7)}.json`))?.n || 0;
  if (month + writes >= c.monthlyWrites) return json(503, { error: "monthly cap" }, { "retry-after": "86400" });
  return null;
}

async function count(env, who, now, writes) {
  await bump(env, `limits/key/${who.hash}/${hour(now)}.json`);
  await bump(env, `limits/${day(now)}.json`);
  await bump(env, `limits/${day(now).slice(0, 7)}.json`, writes);
}

async function postScans(request, env, now) {
  const c = cfg(env);
  const who = await member(env, request);
  if (!who) return json(401, { error: "key" });
  const limited = await overLimit(env, c, who, now, 3 + MAX_SCANS * 2);
  if (limited) return limited;
  const { body, error } = await readBody(request);
  if (error) return json(error, { error: "body" });
  if (body.format !== SCANS_FORMAT || !Array.isArray(body.scans)) return json(400, { error: "format" });
  if (body.scans.length === 0 || body.scans.length > MAX_SCANS) return json(400, { error: "count" });
  for (const scan of body.scans) {
    const bad = checkScan(scan, c, now);
    if (bad === "region" || bad === "faction" || bad === "guild") return json(403, { error: bad, id: scan?.id });
    if (bad) return json(400, { error: bad, id: scan?.id });
  }

  const results = [];
  let writes = 3;
  for (const scan of body.scans) {
    // Other client languages: answered like a duplicate so NRC Sync counts it as sent and moves on.
    if (scan.locale && scan.locale !== LOCALE) { results.push({ id: scan.id, dup: true, skipped: "locale" }); continue; }
    const path = `raw/scans/${day(scan.t)}/${hour(scan.t).slice(8)}/${scan.id}.json.gz`;
    if (await env.BUCKET.head(path)) { results.push({ id: scan.id, dup: true }); continue; }
    const slotKey = `limits/slot/${hour(scan.t)}.json`;
    const slot = (await getJson(env, slotKey))?.n || 0;
    if (slot >= c.perSlot) { results.push({ id: scan.id, enough: true }); continue; }   // that hour is covered
    const record = { received: now, member: who.name, app: String(body.app || "").slice(0, 40), scan };
    await env.BUCKET.put(path, await gzip(JSON.stringify(record)), {
      httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
    });
    await bump(env, slotKey);
    writes += 2;
    results.push({ id: scan.id, stored: true });
  }
  await count(env, who, now, writes);
  return json(200, { ok: true, scans: results });
}

// No login: every NRC Sync install asks for its own key once. Not a real lock (anyone with the app could
// do it), but each key can be limited or revoked, and junk data gets filtered out later anyway.
async function postRegister(request, env, now) {
  const c = cfg(env);
  const { body, error } = await readBody(request);
  if (error) return json(error, { error: "body" });
  const name = String(body?.name || "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipKey = `limits/ip/${(await sha256(ip + day(now))).slice(0, 24)}/${day(now)}.json`;
  if (((await getJson(env, ipKey))?.n || 0) >= c.keysPerIp) return json(429, { error: "too many keys" }, { "retry-after": "86400" });
  const month = (await getJson(env, `limits/${day(now).slice(0, 7)}.json`))?.n || 0;
  if (month + 3 >= c.monthlyWrites) return json(503, { error: "monthly cap" }, { "retry-after": "86400" });
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await sha256(key);
  const member = name || `install-${hash.slice(0, 8)}`;
  await env.BUCKET.put(`keys/${hash}.json`, JSON.stringify({ member, created: now, app: String(body?.app || "").slice(0, 40) }));
  await bump(env, ipKey);
  await bump(env, `limits/${day(now).slice(0, 7)}.json`, 2);
  return json(200, { ok: true, key, member });
}

async function postNames(request, env, now) {
  const c = cfg(env);
  const who = await member(env, request);
  if (!who) return json(401, { error: "key" });
  const limited = await overLimit(env, c, who, now, 4);
  if (limited) return limited;
  const { body, error } = await readBody(request);
  if (error) return json(error, { error: "body" });
  if (body.format !== NAMES_FORMAT || !/^[a-z]{2}[A-Z]{2}$/.test(body.locale || "")) return json(400, { error: "format" });
  if (!body.names || typeof body.names !== "object") return json(400, { error: "names" });
  if (body.locale !== LOCALE) {
    await count(env, who, now, 3);
    return json(200, { ok: true, skipped: "locale" });
  }
  const safe = String(who.name).replace(/[^\w-]/g, "_").slice(0, 40);
  const path = `raw/names/${body.locale}/${safe}-${day(now)}-${clock(now)}.json.gz`;
  await env.BUCKET.put(path, await gzip(JSON.stringify({ received: now, member: who.name, names: body.names })));
  await count(env, who, now, 4);
  return json(200, { ok: true });
}

// Price file for GuildKit's tooltip (out/ingame.txt, written by the hourly job). Same install key as uploads.
// Reads only, so no write limits; ETag lets NRC Sync ask "changed?" for almost nothing.
async function getPrices(request, env) {
  const who = await member(env, request);
  if (!who) return json(401, { error: "key" });
  const obj = await env.BUCKET.get("out/ingame.txt", { onlyIf: request.headers });
  if (!obj) return json(404, { error: "no prices yet" });
  const headers = { "content-type": "text/plain; charset=utf-8", etag: obj.httpEtag, "cache-control": "private, max-age=600" };
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const now = Math.floor(Date.now() / 1000);
    try {
      if (request.method === "POST" && url.pathname === "/v1/scans") return await postScans(request, env, now);
      if (request.method === "POST" && url.pathname === "/v1/register") return await postRegister(request, env, now);
      if (request.method === "POST" && url.pathname === "/v1/names") return await postNames(request, env, now);
      if (request.method === "GET" && url.pathname === "/v1/prices") return await getPrices(request, env);
      if (request.method === "GET" && url.pathname === "/v1/health") {
        const today = (await getJson(env, `limits/${day(now)}.json`))?.n || 0;
        return json(200, { ok: true, uploadsToday: today });
      }
      return json(404, { error: "not found" });
    } catch (e) {
      console.log("intake error", e && e.stack);
      return json(500, { error: "server" });
    }
  },
};
