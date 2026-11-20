// node --test worker/test   (Node 20+: Web Crypto, Compression Streams and Response are built in)
import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import worker, { checkScan } from "../src/index.js";

class FakeBucket {
  constructor() { this.m = new Map(); this.puts = 0; }
  async get(k) {
    if (!this.m.has(k)) return null;
    const v = this.m.get(k);
    return { json: async () => JSON.parse(typeof v === "string" ? v : Buffer.from(v).toString()) };
  }
  async head(k) { return this.m.has(k) ? {} : null; }
  async put(k, v) { this.puts++; this.m.set(k, typeof v === "string" ? v : new Uint8Array(v)); }
}

const KEY = "test-upload-key-0123456789abcdef";
const now = () => Math.floor(Date.now() / 1000);

function env() {
  const bucket = new FakeBucket();
  const hash = createHash("sha256").update(KEY).digest("hex");
  bucket.m.set(`keys/${hash}.json`, JSON.stringify({ member: "Salty Dayn" }));
  return { BUCKET: bucket };
}

function scan(over = {}) {
  const data = "2589,90,90,100,25,2,90*5;100*20\n15229:-17,50000,50000,50000,2,2,50000*1;70000*1\n118,5,5,5,1,1";
  return { id: "a1b2c3d4e5f6-" + (now() - 60), t: now() - 60, region: "EU", realm: "Normal", faction: "Horde",
    locale: "enUS", ver: "0.13.0", src: "own", n: 1000, read: 1000, cov: 1, dur: 30, items: 3, data, ...over };
}

function req(path, body, { key = KEY, zip = true } = {}) {
  const raw = JSON.stringify(body);
  const headers = { authorization: `Bearer ${key}` };
  if (zip) headers["content-encoding"] = "gzip";
  return new Request("https://x" + path, { method: "POST", headers, body: zip ? gzipSync(raw) : raw });
}

const postMany = (e, list, opt) => worker.fetch(req("/v1/scans", { format: "nrc-market-scans/1", app: "nrc-sync 2.0.0", scans: list }, opt), e);
const post = (e, s, opt) => postMany(e, [s], opt);

test("good scan is stored once, gzipped, with the member name", async () => {
  const e = env();
  const s = scan();
  let r = await post(e, s);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, scans: [{ id: s.id, stored: true }] });
  const key = [...e.BUCKET.m.keys()].find((k) => k.startsWith("raw/scans/"));
  assert.match(key, /^raw\/scans\/\d{4}-\d\d-\d\d\/\d\d\/a1b2c3d4e5f6-\d+\.json\.gz$/);
  const rec = JSON.parse(gunzipSync(Buffer.from(e.BUCKET.m.get(key))).toString());
  assert.equal(rec.member, "Salty Dayn");
  assert.equal(rec.scan.data, s.data);
  r = await post(e, s);
  assert.deepEqual(await r.json(), { ok: true, scans: [{ id: s.id, dup: true }] });
});

test("plain (not gzipped) uploads work too", async () => {
  const r = await post(env(), scan(), { zip: false });
  assert.equal(r.status, 200);
});

test("bad or missing key is refused", async () => {
  assert.equal((await post(env(), scan(), { key: "nope-nope-nope-nope-nope-nope" })).status, 401);
  assert.equal((await post(env(), scan(), { key: "" })).status, 401);
});

test("wrong faction or region is refused with 403", async () => {
  assert.equal((await post(env(), scan({ faction: "Alliance" }))).status, 403);
  assert.equal((await post(env(), scan({ region: "US" }))).status, 403);
});

test("broken scans are refused with 400", async () => {
  const e = env();
  for (const bad of [{ data: "garbage" }, { items: 5 }, { cov: 2 }, { t: now() + 3600 }, { id: "x" },
    { t: now() - 40 * 86400 }]) {
    const r = await post(e, scan(bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test("per-key hourly limit answers 429", async () => {
  const e = env();
  for (let i = 0; i < 3; i++) {
    const r = await post(e, scan({ id: `a1b2c3d4e5f6-${now() - 100 - i}` }));
    assert.equal(r.status, 200);
  }
  const r = await post(e, scan({ id: `a1b2c3d4e5f6-${now() - 500}` }));
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("retry-after"));
});

test("a batch of up to 4 scans in one request, more is refused", async () => {
  const e = env();
  const four = [0, 1, 2, 3].map((i) => scan({ id: `a1b2c3d4e5f6-${now() - 3600 * i - 60}`, t: now() - 3600 * i - 60 }));
  const r = await postMany(e, four);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).scans.filter((x) => x.stored).length, 4);
  assert.equal((await postMany(e, [...four, scan()])).status, 400);
});

test("only 8 scans are kept per hour of the day", async () => {
  const e = env();
  e.PER_KEY_PER_HOUR = "100";
  const t = now() - 120;
  let stored = 0, enough = 0;
  for (let i = 0; i < 10; i++) {
    const res = await (await post(e, scan({ id: `abcd${i}efgh-${t}`, t }))).json();
    stored += res.scans[0].stored ? 1 : 0;
    enough += res.scans[0].enough ? 1 : 0;
  }
  assert.equal(stored, 8);
  assert.equal(enough, 2);
});

test("guild filter when set", async () => {
  const e = env();
  e.ALLOWED_GUILDS = "Naga Rave Cave";
  assert.equal((await post(e, scan({ guild: "Other Guild" }))).status, 403);
  assert.equal((await post(e, scan({ guild: "Naga Rave Cave" }))).status, 200);
});

test("register hands out a working key, a few per address per day", async () => {
  const e = env();
  const reg = (ip) => worker.fetch(new Request("https://x/v1/register", { method: "POST",
    headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ app: "nrc-sync 2.0.0", name: "Salty Dayn" }) }), e);
  const r = await reg("1.2.3.4");
  assert.equal(r.status, 200);
  const { key, member } = await r.json();
  assert.equal(member, "Salty Dayn");
  assert.equal((await post(e, scan(), { key })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await reg("1.2.3.4")).status, 200);
  assert.equal((await reg("1.2.3.4")).status, 429);
  assert.equal((await reg("5.6.7.8")).status, 200);
});

test("daily cap answers 503", async () => {
  const e = env();
  e.DAILY_UPLOAD_CAP = "1";
  assert.equal((await post(e, scan())).status, 200);
  assert.equal((await post(e, scan({ id: `a1b2c3d4e5f6-${now() - 900}` }))).status, 503);
});

test("names upload: one file per upload, so a second upload the same day doesn't overwrite the first", async () => {
  const e = env();
  const send = (names) => worker.fetch(req("/v1/names", { format: "nrc-market-names/1", locale: "enUS", names }), e);
  const realNow = Date.now;
  try {
    Date.now = () => Date.UTC(2026, 10, 5, 10, 0, 0);
    assert.equal((await send({ 2589: "Linen Cloth|1|7|5|5|0|200" })).status, 200);
    Date.now = () => Date.UTC(2026, 10, 5, 18, 30, 5);
    assert.equal((await send({ 2592: "Wool Cloth|1|7|5|15|0|200" })).status, 200);
  } finally { Date.now = realNow; }
  const files = [...e.BUCKET.m.keys()].filter((k) => k.startsWith("raw/names/")).sort();
  assert.deepEqual(files, ["raw/names/enUS/Salty_Dayn-2026-11-05-100000.json.gz", "raw/names/enUS/Salty_Dayn-2026-11-05-183005.json.gz"]);
});

test("German client: names and scans are answered ok but not kept", async () => {
  const e = env();
  const r = await worker.fetch(req("/v1/names", { format: "nrc-market-names/1", locale: "deDE",
    names: { 2589: "Leinenstoff|1|7|5|5|0|200" } }), e);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, skipped: "locale" });
  const s = scan({ locale: "deDE" });
  const res = await (await post(e, s)).json();
  assert.deepEqual(res.scans, [{ id: s.id, dup: true, skipped: "locale" }]);
  assert.ok(![...e.BUCKET.m.keys()].some((k) => k.startsWith("raw/")));
});

test("checkScan spot-checks lines across the whole file", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `${1000 + i},1,1,1,1,1`);
  lines[250] = "oops";
  const c = { regions: ["EU"], factions: ["Horde"] };
  const reason = checkScan(scan({ data: lines.join("\n"), items: 500 }), c, now());
  assert.match(reason, /^bad line/);
});

test("price file for the tooltip: install key only, 304 when unchanged", async () => {
  const e = env();
  e.BUCKET.get = async (k, opt) => {
    if (k.startsWith("keys/")) return FakeBucket.prototype.get.call(e.BUCKET, k);
    if (k !== "out/ingame.txt") return null;
    const etag = '"v1"';
    if (opt && opt.onlyIf && opt.onlyIf.get && opt.onlyIf.get("if-none-match") === etag) return { httpEtag: etag };
    return { httpEtag: etag, body: "id,market,usual,sold,vendor\n2589,28,30,17268,13\n" };
  };
  const get = (headers) => worker.fetch(new Request("https://x/v1/prices", { headers }), e);
  assert.equal((await get({})).status, 401);
  let r = await get({ authorization: `Bearer ${KEY}` });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /2589,28,30,17268,13/);
  r = await get({ authorization: `Bearer ${KEY}`, "if-none-match": '"v1"' });
  assert.equal(r.status, 304);
});
