"""One-off, read only: compare TSM's Forever file with our own latest scan."""
import csv, io, json, statistics, sys, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from store import R2Store
s = R2Store("nrc-market", 0)
latest = s.get_json("out/latest.json") or {}
names = s.get_json("out/names.json") or {}
print("tsm_status:", json.dumps(s.get_json("out/tsm_status.json"))[:1500])
items = latest.get("items", {})
print("ours: items", len(items), "updated", latest.get("updated"), "scans24h", latest.get("scans24h"), "contributors", latest.get("contributors24h"))
print("names:", len(names), "with icon:", sum(1 for v in names.values() if "icon" in v), "sample:", list(names.items())[:2])
url = "https://public-data.tradeskillmaster.com/forever/eu/realm/normal-horde/items.csv"
req = urllib.request.Request(url, headers={"User-Agent": "nrc-market/1 (guild price archive)"})
with urllib.request.urlopen(req, timeout=60) as r:
    print("tsm headers:", {k: v for k, v in r.headers.items() if k.lower() in ("last-modified", "content-length", "date", "etag")})
    text = r.read().decode("utf-8", "replace")
rows = list(csv.reader(io.StringIO(text)))
print("tsm header:", rows[0]); print("tsm rows:", len(rows) - 1)
for row in rows[1:6]: print("  ", row)
hdr = rows[0]
def col(*cands):
    for c in cands:
        if c in hdr: return hdr.index(c)
    return None
iid, imv, imin, inum, iqty = col("itemString", "itemId", "id"), col("marketValue"), col("minBuyout"), col("numAuctions"), col("quantity")
tsm = {}
for row in rows[1:]:
    key = row[iid].replace("i:", "")
    tsm[key] = row
both = [k for k in items if k.split(":")[0] in tsm and ":" not in k]
print("overlap with our items:", len(both), "of ours", len(items), "| TSM-only:", len(set(tsm) - {k.split(':')[0] for k in items}))
ratios = []
for k in both:
    t = tsm[k]; o = items[k]
    if imv is not None and t[imv] and o.get("med"):
        ratios.append(int(t[imv]) / o["med"])
if ratios:
    print("TSM marketValue / our median: median %.2f, p25 %.2f, p75 %.2f, within ±20%%: %d of %d" % (
        statistics.median(ratios), statistics.quantiles(ratios, n=4)[0], statistics.quantiles(ratios, n=4)[2],
        sum(1 for r in ratios if 0.8 <= r <= 1.2), len(ratios)))
by_listings = sorted(both, key=lambda k: -items[k].get("listings", 0))[:15]
print("top 15 by our listings: name | ours min/p10/med listings | TSM row")
for k in by_listings:
    o = items[k]; n = names.get(k, {}).get("en", "?")
    print(f"  {n[:28]:28} | {o.get('min')}/{o.get('p10')}/{o.get('med')} {o.get('listings')} | {tsm[k]}")
