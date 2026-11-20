"""Turns uploaded scans into the files the market website reads.

Per run (hourly):
1. Find uploads we haven't seen (raw/scans/...). Note which hour each belongs to.
2. For every hour that got new scans, merge all scans of that hour into one snapshot per item:
   weighted median of each number, weight = how much of the AH the scan read x how late in the hour it was.
   With 3+ scans in an hour, a scan whose prices sit far away from the others is left out (flags.json).
3. Write hourly history (one folder per day, 64 files split by item ID, last 30 days), monthly daily
   rollups, latest.json (current state + 6 h / 24 h change), names.json.
   Per day folders keep every file small even with a million+ listings in the AH: a run only touches the
   days that got new scans.
4. Delete uploads and hourly history older than 30 days (the daily rollups stay).
"""
import gzip
import json
import re
import time
from collections import defaultdict

import icons

HOUR = 3600
KEEP_DAYS = 30
KEEP_RAW_DAYS = 30
SHARDS = 64
OUTLIER = (0.67, 1.5)          # a scan's typical price vs everyone else's
FIELDS = ("min", "p10", "med", "units", "listings")
LOCALE = "enUS"                # English clients only (Joshua, 4 Nov); the intake already drops the rest
DAILY_V = 2                    # daily rollups got p10 (12 Nov): rebuilt once from the hourly history
NAMES_V = 2                    # names.json rebuilt from every file once: English only + icons (6 Nov)
NAME_FILE = re.compile(r"-(\d{4}-\d{2}-\d{2})(-\d{6})?\.json\.gz$")   # old files: no time part


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
    return f"{int(key.split(':')[0]) % SHARDS:02x}"


def day_of(h):
    return time.strftime("%Y-%m-%d", time.gmtime(int(h)))


def history_path(d, sh):
    return f"out/history/{d}/{sh}.json"


def load_scan(store, path):
    rec = json.loads(gzip.decompress(store.get(path)))
    s = rec["scan"]
    return {"id": s["id"], "t": s["t"], "cov": float(s.get("cov", 1)), "member": rec.get("member"),
            "locale": s.get("locale") or LOCALE, "items": parse(s["data"])}


def run(store, now=None, icon_map=None, icon_cfg=None, lookup=None):
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
        if s["locale"] != LOCALE:                       # stored before the intake filtered them
            done[sid] = [path, h, s["member"], "skip"]
            continue
        done[sid] = [path, h, s["member"]]
        hours.setdefault(str(h), []).append(sid)
        touched.add(h)

    flags = store.get_json("out/flags.json") or []
    shards, ladders = {}, store.get_json("out/ladders.json") or {}     # (day, shard) -> {key: {hour: nums}}

    def shard(d, sh):
        if (d, sh) not in shards:
            shards[(d, sh)] = store.get_json(history_path(d, sh)) or {}
        return shards[(d, sh)]

    changed = set()
    for h in sorted(touched):
        scans = [load_scan(store, done[sid][0]) for sid in hours[str(h)] if store.get(done[sid][0]) is not None]
        if not scans:
            continue
        snap, lad, excluded = merge_hour(scans, h)
        for sid in excluded:
            flags.append({"scan": sid, "member": done[sid][2], "hour": h})
        d = day_of(h)
        for k, nums in snap.items():
            sh = shard_of(k)
            shard(d, sh).setdefault(k, {})[str(h)] = nums
            changed.add((d, sh))
        for k, l in lad.items():
            if k not in ladders or ladders[k][0] <= h:
                ladders[k] = [h, l]

    if state.get("daily_v") != DAILY_V:                 # rebuild every day we still have hourly history for
        days = sorted({p.split("/")[2] for p in store.list("out/history/")})
        for d in days:
            for i in range(SHARDS):
                shard(d, f"{i:02x}")
        write_daily(store, {key: v for key, v in shards.items() if v})
        state["daily_v"] = DAILY_V

    if touched:
        for d, sh in sorted(changed):
            store.put_json(history_path(d, sh), shards[(d, sh)])
        write_daily(store, {key: v for key, v in shards.items() if key in changed})
        write_latest(store, shard, ladders, done, now)
        store.put_json("out/ladders.json", ladders)
        store.put_json("out/flags.json", flags[-500:])

    names_done = merge_names(store, state, now, icon_map or {}, icon_cfg or {}, lookup)
    write_ingame(store, now)
    cleaned = cleanup(store, done, hours, now)
    store.put_json("out/_state.json", state)
    return {"new_hours": len(touched), "names": names_done, "deleted": cleaned, "writes": store.writes}


def write_daily(store, day_shards):
    """day_shards: {(day, shard): {key: {hour: nums}}} -> out/daily/<YYYY-MM>.json {key: {day: [low, median, units, p10]}}
    Each value is the middle of that day's hourly values (low = the lowest). p10 = the site's headline price."""
    months = defaultdict(lambda: defaultdict(dict))
    for (d, _), data in day_shards.items():
        for k, per_hour in data.items():
            vals = list(per_hour.values())
            meds = sorted(v[2] for v in vals)
            units = sorted(v[3] for v in vals)
            p10s = sorted(v[1] for v in vals)
            months[d[:7]][k][d] = [min(v[0] for v in vals), meds[len(meds) // 2], units[len(units) // 2],
                                   p10s[len(p10s) // 2]]
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


def write_latest(store, shard, ladders, done, now):
    """current state per item from the last 2 days of hourly history (items unseen for 2 days drop out)"""
    per_item = defaultdict(dict)
    for d in (day_of(now - 86400), day_of(now)):
        for i in range(SHARDS):
            for k, per_hour in shard(d, f"{i:02x}").items():
                per_item[k].update(per_hour)
    items = {}
    for k, per_hour in per_item.items():
        last_h = max(int(h) for h in per_hour)
        v = per_hour[str(last_h)]
        row = dict(zip(FIELDS, v))
        row["seen"] = last_h
        for back in (6, 24):
            old = _near(per_hour, last_h - back * HOUR)
            # ch = median change (kept as it was), pc = market price (p10) change, what the site shows
            row[f"ch{back}"] = round((v[2] - old[2]) / old[2], 4) if old and old[2] else None
            row[f"pc{back}"] = round((v[1] - old[1]) / old[1], 4) if old and old[1] else None
        if k in ladders:
            row["ladder"] = ladders[k][1]
        items[k] = row
    recent = [d for d in done.values() if d[1] >= now - 24 * HOUR and len(d) < 4]
    store.put_json("out/latest.json", {
        "updated": now,
        "scans24h": len(recent),
        "contributors24h": len({d[2] for d in recent}),
        "lastScanHour": max((d[1] for d in done.values()), default=None),
        "items": items,
    })


INGAME_FROM = "2026-11-08"      # launch week (5-7 Nov) left out of the usual price, like on the site


def write_ingame(store, now):
    """Small price file for GuildKit's tooltip (NRC Sync fetches it from the intake's GET /v1/prices):
    out/ingame.txt, one line per item: id,market,usual,sold,vendor (copper; sold = per day across EU from TSM;
    empty = unknown). market = our p10, or TSM's Horde price for items no guild scan has seen.
    usual = median of the daily p10 of the last 7 days. Written only when something changed."""
    latest = (store.get_json("out/latest.json") or {}).get("items") or {}
    names = store.get_json("out/names.json") or {}
    tsm = store.get_json("out/tsm.json") or {}
    cols = tsm.get("cols") or []
    tsm_items = tsm.get("items") or {}
    ix = {c: cols.index(c) for c in ("min", "recent", "sold") if c in cols}
    months = sorted({time.strftime("%Y-%m", time.gmtime(now - d * 86400)) for d in (0, 8)})
    daily = {}
    for m in months:
        for k, per_day in (store.get_json(f"out/daily/{m}.json") or {}).items():
            daily.setdefault(k.split(":")[0], {}).update(per_day)
    cut = time.strftime("%Y-%m-%d", time.gmtime(now - 7 * 86400))
    today = day_of(now)
    market = {}
    for k, v in latest.items():
        i = k.split(":")[0]
        if isinstance(v, dict) and v.get("p10") and (i not in market or v["p10"] < market[i]):
            market[i] = v["p10"]                       # suffix variants: the cheapest, like the site
    for i, v in tsm_items.items():
        if i not in market and "recent" in ix:
            price = v[ix["recent"]] or (v[ix["min"]] if "min" in ix else 0)
            if price:
                market[i] = price
    lines = []
    for i in sorted(set(market) | {i for i, e in names.items() if "sell" in e}, key=int):
        days = [d[3] if len(d) > 3 else d[1] for day, d in (daily.get(i) or {}).items()
                if cut <= day < today and day >= INGAME_FROM]
        days.sort()
        usual = days[len(days) // 2] if len(days) >= 3 else ""
        t = tsm_items.get(i)
        sold = t[ix["sold"]] if t and "sold" in ix and t[ix["sold"]] else ""
        sell = names.get(i, {}).get("sell", "")
        lines.append(f"{i},{market.get(i, '')},{usual},{sold},{sell}")
    body = "# nrc-market in-game prices v1\n" + f"updated={now}\n" + "id,market,usual,sold,vendor\n" + "\n".join(lines) + "\n"
    old = store.get("out/ingame.txt")
    if old is None or old.decode("utf-8").split("\n", 2)[2] != body.split("\n", 2)[2]:
        store.put("out/ingame.txt", body.encode("utf-8"))


def _name_day(path):
    m = NAME_FILE.search(path)
    return m and m.group(1)


def merge_names(store, state, now, icon_map, icon_cfg, lookup=None):
    """English names + item info from raw/names/enUS/, plus icon names (jobs/icons.py) -> out/names.json.
    Files uploaded before 6 Nov have one name per member and day and could be overwritten later that day,
    so those are read again while they're from today or yesterday."""
    if state.get("names_v") != NAMES_V:
        state["names_v"], state["names"], names = NAMES_V, [], {}
    else:
        names = store.get_json("out/names.json") or {}
    seen = set(state.get("names", []))
    before = json.dumps(names, sort_keys=True)
    recent = {day_of(now - 86400), day_of(now)}
    listed = store.list(f"raw/names/{LOCALE}/")
    new = []
    for p in listed:
        m = NAME_FILE.search(p)
        if m and (p not in seen or (not m.group(2) and m.group(1) in recent)):
            new.append(p)
    for p in sorted(new, key=lambda p: (_name_day(p), p)):
        rec = store.get_json(p) or {}
        for item_id, text in rec.get("names", {}).items():
            parts = str(text).split("|")
            if len(parts) < 7:
                continue
            try:
                nums = [int(x) for x in parts[1:7]]
            except ValueError:
                continue
            e = names.setdefault(str(item_id), {})
            e["en"] = parts[0]
            e.update(dict(zip(("q", "cls", "sub", "ilvl", "req", "stack"), nums)))
            if len(parts) > 7 and parts[7].isdigit() and int(parts[7]) > 0:
                e["iconId"] = int(parts[7])
            if len(parts) > 8 and parts[8].isdigit():           # vendor sell price (copper), when GuildKit sends it
                e["sell"] = int(parts[8])
        seen.add(p)
    state["names"] = sorted(p for p in seen if p in set(listed))
    wh = state.setdefault("wh", {})
    if state.get("wh_url") != icon_cfg.get("wowhead"):      # new address: ask again for everything it missed
        state["wh_url"] = icon_cfg.get("wowhead")
        for k in [k for k, v in wh.items() if not v[1]]:
            del wh[k]
    latest_items = (store.get_json("out/latest.json") or {}).get("items") or {}
    seen_ids = {k.split(":")[0] for k in latest_items}
    listed = defaultdict(int)
    for k, v in latest_items.items():
        listed[k.split(":")[0]] += v.get("listings", 0) if isinstance(v, dict) else 0
    # items only TSM has seen on the Horde AH get a name and icon too (the site shows them in search)
    seen_ids |= {i for i, v in ((store.get_json("out/tsm.json") or {}).get("items") or {}).items() if any(v[:3])}
    vend = state.setdefault("vend", {})
    stats = icons.fill(names, icon_map, wh, now, lookup, icon_cfg.get("wowheadPerRun", 0), seen=seen_ids, vend=vend)
    print("icons:", stats)
    print("vendor:", icons.fill_vendor(names, vend, lookup, icon_cfg.get("vendorPerRun", 0), seen=seen_ids, prio=listed))
    if json.dumps(names, sort_keys=True) != before:
        store.put_json("out/names.json", names)
    return len(new)


def cleanup(store, done, hours, now):
    cutoff = time.strftime("%Y-%m-%d", time.gmtime(now - KEEP_RAW_DAYS * 86400))
    old = [p for p in store.list("raw/scans/") if p.split("/")[2] < cutoff]
    hist_cut = time.strftime("%Y-%m-%d", time.gmtime(now - KEEP_DAYS * 86400))
    old_hist = [p for p in store.list("out/history/") if p.split("/")[2] < hist_cut]
    old_names = [p for p in store.list("raw/names/") if (_name_day(p) or "9") < cutoff]
    if old or old_hist or old_names:
        store.delete(old + old_hist + old_names)
    for sid in [s for s, d in done.items() if d[1] < now - (KEEP_RAW_DAYS + 5) * 86400]:
        del done[sid]
    for h in [h for h in hours if int(h) < now - (KEEP_RAW_DAYS + 5) * 86400]:
        del hours[h]
    return len(old)
