"""One-off, read only: what arrived in each upload."""
import gzip, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from store import R2Store
s = R2Store("nrc-market", 0)
names = s.get_json("out/names.json") or {}
latest = (s.get_json("out/latest.json") or {}).get("items", {})
allkeys = set()
for p in s.list("raw/scans/"):
    rec = json.loads(gzip.decompress(s.get(p)))
    sc = rec["scan"]
    lines = [l for l in sc["data"].split("\n") if l.count(",") >= 5]
    keys = {l.split(",")[0] for l in lines}
    allkeys |= keys
    ids = {k.split(":")[0] for k in keys}
    meta = {k: v for k, v in sc.items() if k != "data"}
    top = {k: v for k, v in rec.items() if k != "scan"}
    print(p, "| keys", len(keys), "| base ids", len(ids), "| units", sum(int(l.split(',')[4]) for l in lines), "| listings", sum(int(l.split(',')[5]) for l in lines))
    print("   scan meta:", json.dumps(meta)[:400]); print("   record:", json.dumps(top)[:300])
print("raw/names uploads:", s.list("raw/names/"))
ids = {k.split(":")[0] for k in allkeys}
print("all keys", len(allkeys), "base ids", len(ids), "named", len(ids & set(names)), "latest keys", len(latest))
