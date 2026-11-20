"""Compares TSM's Forever files with our own prices. Read-only, prints a report.

    python jobs/tsm_compare.py            (needs the R2 env vars, like run.py)

Our side: out/latest.json. TSM side: the newest copies in tsm/ (copied hourly by tsm.py), plus how often
TSM changed each file since we started copying.
"""
import csv
import gzip
import io
import statistics as st
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from store import R2Store  # noqa: E402

FILES = {"realm": "tsm/forever/eu/realm/normal-horde/items/", "region": "tsm/forever/eu/region/items/"}


def newest(store, prefix):
    keys = sorted(store.list(prefix))
    if not keys:
        return keys, []
    body = gzip.decompress(store.get(keys[-1])).decode("utf-8", "replace")
    return keys, list(csv.DictReader(io.StringIO(body)))


def ratio_report(label, pairs):
    """pairs: (ours, theirs) in copper. How close are they?"""
    r = [t / o for o, t in pairs if o > 0 and t > 0]
    if not r:
        print(f"  {label}: no pairs")
        return
    within = lambda p: sum(1 for x in r if 1 / (1 + p) <= x <= 1 + p) / len(r) * 100
    print(f"  {label}: {len(r)} items, median ratio {st.median(r):.2f}, "
          f"within 10% {within(0.10):.0f}%, within 25% {within(0.25):.0f}%, off by 2x+ {sum(1 for x in r if x > 2 or x < 0.5) / len(r) * 100:.0f}%")


def main():
    store = R2Store("nrc-market", 0)
    latest = store.get_json("out/latest.json") or {}
    names = store.get_json("out/names.json") or {}
    ours = {k: v for k, v in (latest.get("items") or {}).items() if ":" not in k}
    print("ours: updated", time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(latest.get("updated", 0))),
          "| items", len(latest.get("items") or {}), "| scans 24h", latest.get("scans24h"),
          "| scanners 24h", latest.get("contributors24h"))

    tsm = {}
    for kind, prefix in FILES.items():
        keys, rows = newest(store, prefix)
        stamps = [k[len(prefix):].removesuffix(".csv.gz") for k in keys]
        print(f"\nTSM {kind}: {len(keys)} versions since we started copying; changed at (UTC): {', '.join(stamps[-30:])}")
        if rows:
            ups = sorted({r.get('updatedAt') for r in rows})
            print(f"  newest copy: {len(rows)} rows, updatedAt {ups[0]} .. {ups[-1]}")
        tsm[kind] = {r["itemId"]: r for r in rows}

    realm, region = tsm["realm"], tsm["region"]
    both = set(ours) & set(realm)
    print(f"\nCoverage: ours {len(ours)} items, TSM Horde {len(realm)}, both {len(both)}, "
          f"only ours {len(set(ours) - set(realm))}, only TSM {len(set(realm) - set(ours))}")
    only_tsm = sorted(set(realm) - set(ours), key=lambda i: -int(realm[i].get("marketValue") or 0))[:10]
    print("  only in TSM, priciest:", [(i, realm[i].get("name"), realm[i].get("marketValue")) for i in only_tsm])
    only_ours = sorted(set(ours) - set(realm), key=lambda i: -ours[i].get("listings", 0))[:10]
    print("  only ours, most listed:", [(i, names.get(i, {}).get("en"), ours[i].get("listings")) for i in only_ours])

    print("\nPrice agreement (TSM Horde / ours):")
    ratio_report("cheapest now: TSM minBuyout vs our min", [(ours[i]["min"], int(realm[i]["minBuyout"] or 0)) for i in both])
    ratio_report("TSM recent vs our p10 (our headline)", [(ours[i]["p10"], int(realm[i]["recent"] or 0)) for i in both])
    ratio_report("TSM marketValue vs our p10", [(ours[i]["p10"], int(realm[i]["marketValue"] or 0)) for i in both])
    busy = [i for i in both if ours[i].get("listings", 0) >= 20]
    ratio_report("same, items with 20+ listings: TSM marketValue vs our p10",
                 [(ours[i]["p10"], int(realm[i]["marketValue"] or 0)) for i in busy])
    ratio_report("same, items with 20+ listings: TSM minBuyout vs our min",
                 [(ours[i]["min"], int(realm[i]["minBuyout"] or 0)) for i in busy])

    worst = sorted(busy, key=lambda i: -abs((int(realm[i]["marketValue"] or 1) / max(ours[i]["p10"], 1)) - 1))[:12]
    print("\nBiggest gaps among busy items (id, name, our p10, TSM marketValue, TSM minBuyout, our listings):")
    for i in worst:
        r = realm[i]
        print("  ", i, names.get(i, {}).get("en") or r.get("name"), ours[i]["p10"], r["marketValue"], r["minBuyout"], ours[i]["listings"])

    sold = [r for r in region.values() if float(r.get("soldPerDay") or 0) > 0]
    print(f"\nTSM region sales data: {len(sold)} of {len(region)} items have soldPerDay > 0; "
          f"{sum(1 for i in ours if i in region and float(region[i].get('soldPerDay') or 0) > 0)} of our items have it")


if __name__ == "__main__":
    main()
