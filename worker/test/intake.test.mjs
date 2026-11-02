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
    locale: "deDE", ver: "0.13.0", src: "own", n: 1000, read: 1000, cov: 1, dur: 30, items: 3, data, ...over };
}

function req(path, body, { key = KEY, zip = true } = {}) {
  const raw = JSON.stringify(body);
  const headers = { authorization: `Bearer ${key}` };
  if (zip) headers["content-encoding"] = "gzip";
  return new Request("https://x" + path, { method: "POST", headers, body: zip ? gzipSync(raw) : raw });
}

const post = (e, s, opt) => worker.fetch(req("/v1/scan", { format: "nrc-market-scan/1", app: "nrc-sync 2.0.0", scan: s }, opt), e);

test("good scan is stored once, gzipped, with the member name", async () => {
  const e = env();
  const s = scan();
  let r = await post(e, s);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const key = [...e.BUCKET.m.keys()].find((k) => k.startsWith("raw/scans/"));
  assert.match(key, /^raw\/scans\/\d{4}-\d\d-\d\d\/a1b2c3d4e5f6-\d+\.json\.gz$/);
  const rec = JSON.parse(gunzipSync(Buffer.from(e.BUCKET.m.get(key))).toString());
  assert.equal(rec.member, "Salty Dayn");
  assert.equal(rec.scan.data, s.data);
  r = await post(e, s);
  assert.deepEqual(await r.json(), { ok: true, dup: true });
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
  for (let i = 0; i < 10; i++) {
    const r = await post(e, scan({ id: `a1b2c3d4e5f6-${now() - 100 - i}` }));
    assert.equal(r.status, 200);
  }
  const r = await post(e, scan({ id: `a1b2c3d4e5f6-${now() - 500}` }));
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("retry-after"));
});

test("daily cap answers 503", async () => {
  const e = env();
  e.DAILY_UPLOAD_CAP = "1";
  assert.equal((await post(e, scan())).status, 200);
  assert.equal((await post(e, scan({ id: `a1b2c3d4e5f6-${now() - 900}` }))).status, 503);
});

test("names upload", async () => {
  const e = env();
  const r = await worker.fetch(req("/v1/names", { format: "nrc-market-names/1", locale: "deDE",
    names: { 2589: "Leinenstoff|1|7|5|5|0|200" } }), e);
  assert.equal(r.status, 200);
  assert.ok([...e.BUCKET.m.keys()].some((k) => /^raw\/names\/deDE\/Salty_Dayn-/.test(k)));
});

test("checkScan spot-checks lines across the whole file", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `${1000 + i},1,1,1,1,1`);
  lines[250] = "oops";
  const c = { regions: ["EU"], factions: ["Horde"] };
  const reason = checkScan(scan({ data: lines.join("\n"), items: 500 }), c, now());
  assert.match(reason, /^bad line/);
});
