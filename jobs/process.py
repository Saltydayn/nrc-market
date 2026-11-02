"""Turns uploaded scans into the files the market website reads.

Per run (hourly):
1. Find uploads we haven't seen (raw/scans/...). Note which hour each belongs to.
2. For every hour that got new scans, merge all scans of that hour into one snapshot per item:
   weighted median of each number, weight = how much of the AH the scan read x how late in the hour it was.
   With 3+ scans in an hour, a scan whose prices sit far away from the others is left out (flags.json).
3. Write hourly history (256 files split by item ID, last 30 days), monthly daily rollups,
   latest.json (current state + 6 h / 24 h change), names.json.
4. Delete uploads older than 30 days (they live on in the history).
"""
import gzip
import json
import time
from collections import defaultdict

HOUR = 3600
KEEP_HOURLY = 30 * 24 * HOUR
KEEP_RAW_DAYS = 30
OUTLIER = (0.67, 1.5)          # a scan's typical price vs everyone else's
FIELDS = ("min", "p10", "med", "units", "listings")


def parse(data):
    """data lines -> {key: [min, p10, med, units, listings, ladder]}"""
    out = {}
    for line in data.split("\n"):
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            nums = [int(x) for x in parts[1:6]]
        except ValueError:
            continue
        out[parts[0]] = nums + [parts[6] if len(parts) > 6 else None]
    return out


def wmedian(pairs):
    """weighted median of (value, weight)"""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    acc = 0
    for v, w in pairs:
        acc += w
        if acc >= total / 2:
            return v
    return pairs[-1][0]


def merge_hour(scans, hour):
    """scans: list of {'items': parsed, 'cov', 't', 'id'} -> (snapshot {key: [5 numbers]}, ladders, excluded ids)"""
    def weight(s):
        late = min(1.0, max(0.0, (s["t"] - hour) / HOUR))
        return max(0.01, s["cov"]) * (0.5 + 0.5 * late)

    def combine(use):
        by_key = defaultdict(list)
        for s in use:
            w = weight(s)
            for k, v in s["items"].items():
                by_key[k].append((v, w))
        snap = {}
        for k, vals in by_key.items():
            snap[k] = [wmedian([(v[i], w) for v, w in vals]) for i in range(5)]
        return snap

    snap = combine(scans)
    excluded = []
    if len(scans) >= 3:
        for s in scans:
            ratios = sorted(v[2] / snap[k][2] for k, v in s["items"].items() if snap.get(k) and snap[k][2] > 0)
            if len(ratios) >= 10:
                typical = ratios[len(ratios) // 2]
                if not (OUTLIER[0] <= typical <= OUTLIER[1]):
                    excluded.append(s["id"])
        if excluded and len(excluded) < len(scans):
            snap = combine([s for s in scans if s["id"] not in excluded])
    ladders = {}
    for s in sorted(scans, key=lambda s: s["t"]):          # newest scan wins
        if s["id"] in excluded:
            continue
        for k, v in s["items"].items():
            if v[5]:
                ladders[k] = v[5]
    return snap, ladders, excluded


def shard_of(key):
    return f"{int(key.split(':')[0]) % 256:02x}"


def load_scan(store, path):
    rec = json.loads(gzip.decompress(store.get(path)))
    s = rec["scan"]
    return {"id": s["id"], "t": s["t"], "cov": float(s.get("cov", 1)), "member": rec.get("member"),
            "items": parse(s["data"])}


def run(store, now=None):
    now = int(now or time.time())
    state = store.get_json("out/_state.json") or {"done": {}, "hours": {}}
    done, hours = state["done"], state["hours"]      # scan id -> [path, hour, member]; hour -> [scan ids]

    touched = set()
    for path in store.list("raw/scans/"):
        sid = path.rsplit("/", 1)[-1].removesuffix(".json.gz")
        if sid in done:
            continue
        s = load_scan(store, path)
        h = s["t"] // HOUR * HOUR
        done[sid] = [path, h, s["member"]]
        hours.setdefault(str(h), []).append(sid)
        touched.add(h)

    flags = store.get_json("out/flags.json") or []
    shards, ladders = {}, store.get_json("out/ladders.json") or {}
    for h in sorted(touched):
        scans = [load_scan(store, done[sid][0]) for sid in hours[str(h)] if store.get(done[sid][0]) is not None]
        if not scans:
            continue
        snap, lad, excluded = merge_hour(scans, h)
        for sid in excluded:
            flags.append({"scan": sid, "member": done[sid][2], "hour": h})
        for k, nums in snap.items():
            sh = shard_of(k)
            if sh not in shards:
                shards[sh] = store.get_json(f"out/history/{sh}.json") or {}
            shards[sh].setdefault(k, {})[str(h)] = nums
        for k, l in lad.items():
            if k not in ladders or ladders[k][0] <= h:
                ladders[k] = [h, l]

    if touched:
        for sh, data in shards.items():
            for k in list(data):
                data[k] = {hh: v for hh, v in data[k].items() if int(hh) >= now - KEEP_HOURLY}
                if not data[k]:
                    del data[k]
            store.put_json(f"out/history/{sh}.json", data)
        write_daily(store, shards, touched)
        write_latest(store, shards, ladders, done, now)
        store.put_json("out/ladders.json", ladders)
        store.put_json("out/flags.json", flags[-500:])

    names_done = merge_names(store, state.setdefault("names", []))
    cleaned = cleanup(store, done, hours, now)
    store.put_json("out/_state.json", state)
    return {"new_hours": len(touched), "names": names_done, "deleted": cleaned, "writes": store.writes}


def write_daily(store, shards, touched_hours):
    months = defaultdict(lambda: defaultdict(dict))
    days = {time.strftime("%Y-%m-%d", time.gmtime(h)) for h in touched_hours}
    for data in shards.values():
        for k, per_hour in data.items():
            per_day = defaultdict(list)
            for hh, v in per_hour.items():
                d = time.strftime("%Y-%m-%d", time.gmtime(int(hh)))
                if d in days:
                    per_day[d].append(v)
            for d, vals in per_day.items():
                meds = sorted(v[2] for v in vals)
                units = sorted(v[3] for v in vals)
                months[d[:7]][k][d] = [min(v[0] for v in vals), meds[len(meds) // 2], units[len(units) // 2]]
    for m, items in months.items():
        cur = store.get_json(f"out/daily/{m}.json") or {}
        for k, per_day in items.items():
            cur.setdefault(k, {}).update(per_day)
        store.put_json(f"out/daily/{m}.json", cur)


def _near(per_hour, target):
    """value at the hour closest to target (within 3 h)"""
    best = None
    for hh, v in per_hour.items():
        d = abs(int(hh) - target)
        if d <= 3 * HOUR and (best is None or d < best[0]):
            best = (d, v)
    return best[1] if best else None


def write_latest(store, shards, ladders, done, now):
    # shards loaded this run cover every item that changed; load the rest so latest.json stays complete
    for i in range(256):
        sh = f"{i:02x}"
        if sh not in shards:
            shards[sh] = store.get_json(f"out/history/{sh}.json") or {}
    items = {}
    for data in shards.values():
        for k, per_hour in data.items():
            last_h = max(int(h) for h in per_hour)
            if last_h < now - 7 * 24 * HOUR:
                continue
            v = per_hour[str(last_h)]
            row = dict(zip(FIELDS, v))
            row["seen"] = last_h
            for label, back in (("ch6", 6), ("ch24", 24)):
                old = _near(per_hour, last_h - back * HOUR)
                row[label] = round((v[2] - old[2]) / old[2], 4) if old and old[2] else None
            if k in ladders:
                row["ladder"] = ladders[k][1]
            items[k] = row
    recent = [d for d in done.values() if d[1] >= now - 24 * HOUR]
    store.put_json("out/latest.json", {
        "updated": now,
        "scans24h": len(recent),
        "contributors24h": len({d[2] for d in recent}),
        "lastScanHour": max((d[1] for d in done.values()), default=None),
        "items": items,
    })


def merge_names(store, seen):
    new = [p for p in store.list("raw/names/") if p not in seen]
    if not new:
        return 0
    names = store.get_json("out/names.json") or {}
    for p in new:
        locale = p.split("/")[2]
        rec = store.get_json(p)
        for item_id, text in rec.get("names", {}).items():
            parts = str(text).split("|")
            if len(parts) < 7:
                continue
            e = names.setdefault(str(item_id), {})
            e[locale[:2]] = parts[0]
            e.update({"q": int(parts[1]), "cls": int(parts[2]), "sub": int(parts[3]), "ilvl": int(parts[4]),
                      "req": int(parts[5]), "stack": int(parts[6])})
        seen.append(p)
    store.put_json("out/names.json", names)
    del seen[:-2000]
    return len(new)


def cleanup(store, done, hours, now):
    cutoff = time.strftime("%Y-%m-%d", time.gmtime(now - KEEP_RAW_DAYS * 86400))
    old = [p for p in store.list("raw/scans/") if p.split("/")[2] < cutoff]
    if old:
        store.delete(old)
    for sid in [s for s, d in done.items() if d[1] < now - (KEEP_RAW_DAYS + 5) * 86400]:
        del done[sid]
    for h in [h for h in hours if int(h) < now - (KEEP_RAW_DAYS + 5) * 86400]:
        del hours[h]
    return len(old)
