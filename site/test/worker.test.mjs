import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../server/worker.js";

function bucket(files) {
  return {
    async head(k) { return k in files ? {} : null; },
    async get(k) {
      if (!(k in files)) return null;
      return { httpEtag: '"x"', body: new Blob([files[k]]).stream() };
    },
  };
}
const req = (p, m = "GET") => new Request("https://site.example" + p, { method: m });

test("members mode: existing file needs sign-in, missing file is a plain 404", async () => {
  const env = { DATA_ACCESS: "members", MARKET: bucket({ "out/latest.json": "{}" }) };
  assert.equal((await worker.fetch(req("/data/latest.json"), env)).status, 401);
  assert.equal((await worker.fetch(req("/data/names.json"), env)).status, 404);
});

test("public mode serves json with cache headers", async () => {
  const env = { DATA_ACCESS: "public", MARKET: bucket({ "out/history/2026-11-01/1d.json": '{"a":1}' }) };
  const res = await worker.fetch(req("/data/history/2026-11-01/1d.json"), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /max-age=86400/);
  assert.deepEqual(await res.json(), { a: 1 });
});

test("only the known out/ files can be read", async () => {
  const env = { DATA_ACCESS: "public", MARKET: bucket({ "out/_state.json": "{}", "keys/abc.json": "{}" }) };
  for (const p of ["/data/_state.json", "/data/../keys/abc.json", "/data/flags.json", "/elsewhere"]) {
    assert.equal((await worker.fetch(req(p), env)).status, 404, p);
  }
  assert.equal((await worker.fetch(req("/data/latest.json", "POST"), env)).status, 405);
});
