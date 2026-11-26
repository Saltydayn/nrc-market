import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { startHourlyJob, jobNeeded } from "../server/worker.js";

function bucket(files) {
  return {
    async get(k) {
      if (!(k in files)) return null;
      return { httpEtag: '"x"', body: new Blob([files[k]]).stream() };
    },
  };
}
const assets = { async fetch(r) { return new Response("asset " + new URL(r.url).pathname); } };
const req = (p, m = "GET") => new Request("https://market.internal" + p, { method: m });

test("serves json with cache headers", async () => {
  const env = { ASSETS: assets, MARKET: bucket({ "out/history/2026-11-01/1d.json": '{"a":1}' }) };
  const res = await worker.fetch(req("/data/history/2026-11-01/1d.json"), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /max-age=86400/);
  assert.deepEqual(await res.json(), { a: 1 });
});

test("missing data file is a plain 404 (site shows its waiting state)", async () => {
  const env = { ASSETS: assets, MARKET: bucket({}) };
  assert.equal((await worker.fetch(req("/data/latest.json"), env)).status, 404);
});

test("only the known out/ files can be read", async () => {
  const env = { ASSETS: assets, MARKET: bucket({ "out/_state.json": "{}", "keys/abc.json": "{}" }) };
  for (const p of ["/data/_state.json", "/data/flags.json", "/data/keys/abc.json"]) {
    assert.equal((await worker.fetch(req(p), env)).status, 404, p);
  }
  // "../" is resolved before we see it, so this lands outside /data/ and never touches the bucket
  assert.equal(await (await worker.fetch(req("/data/../keys/abc.json"), env)).text(), "asset /keys/abc.json");
  assert.equal((await worker.fetch(req("/data/latest.json", "POST"), env)).status, 405);
});

test("everything else goes to the site files", async () => {
  const env = { ASSETS: assets, MARKET: bucket({}) };
  assert.equal(await (await worker.fetch(req("/js/app.js"), env)).text(), "asset /js/app.js");
});

test("hourly kick: starts the GitHub job with the token, skips without one", async () => {
  let call = null;
  const fake = async (url, init) => { call = { url, init }; return new Response(null, { status: 204 }); };
  assert.equal(await startHourlyJob({}, fake), 0);
  assert.equal(call, null);
  assert.equal(await startHourlyJob({ GH_DISPATCH_TOKEN: "t" }, fake), 204);
  assert.match(call.url, /nrc-market\/actions\/workflows\/hourly\.yml\/dispatches$/);
  assert.equal(call.init.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(call.init.body), { ref: "main" });
});

test("tsm.json is readable, TSM's raw copies and status are not", async () => {
  const env = { ASSETS: assets, MARKET: bucket({ "out/tsm.json": '{"items":{}}', "out/tsm_status.json": "{}" }) };
  assert.equal((await worker.fetch(req("/data/tsm.json"), env)).status, 200);
  assert.equal((await worker.fetch(req("/data/tsm_status.json"), env)).status, 404);
});

test("hourly job only starts when a scan arrived since the last run, or every ~3 hours", async () => {
  const H = 3600000, now = Date.parse("2026-11-20T16:07:00Z");
  const bucket = (lastRun, uploads) => ({
    head: async () => (lastRun == null ? null : { uploaded: new Date(lastRun) }),
    list: async ({ prefix }) => ({ objects: uploads.filter((u) => u.key.startsWith(prefix)).map((u) => ({ key: u.key, uploaded: new Date(u.at) })), truncated: false }),
  });
  assert.equal(await jobNeeded(bucket(now - H, []), now), false);
  assert.equal(await jobNeeded(bucket(now - H, [{ key: "raw/scans/2026-11-20/15/a.json.gz", at: now - 2 * H }]), now), false);
  assert.equal(await jobNeeded(bucket(now - H, [{ key: "raw/scans/2026-11-20/15/a.json.gz", at: now - 10 * 60000 }]), now), true);
  // a late upload of yesterday's scan counts too
  assert.equal(await jobNeeded(bucket(now - H, [{ key: "raw/scans/2026-11-19/22/b.json.gz", at: now - 5 * 60000 }]), now), true);
  assert.equal(await jobNeeded(bucket(now - 3 * H, []), now), true);   // TSM, names: at least every ~3 h
  // a new farm tracker upload starts the job too (guild farm file), an old one doesn't
  assert.equal(await jobNeeded(bucket(now - H, [{ key: "farm/in/a1b2c3d4e5f6.json", at: now - 5 * 60000 }]), now), true);
  assert.equal(await jobNeeded(bucket(now - H, [{ key: "farm/in/a1b2c3d4e5f6.json", at: now - 2 * H }]), now), false);
  assert.equal(await jobNeeded(bucket(null, []), now), true);
  assert.equal(await jobNeeded({ head: async () => { throw new Error("down"); } }, now), true);
});
