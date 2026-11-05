import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../server/worker.js";

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
