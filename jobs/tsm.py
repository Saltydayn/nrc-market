"""Copies TSM's public price files into our storage, so we build our own TSM history.

TSM publishes plain CSV snapshots (no key, no limits) at public-data.tradeskillmaster.com. They have no
history, so we keep every version that changed. Forever's file names aren't known until TSM publishes them:
config/tsm.json lists known files plus a few guesses ("probe") that are checked every run. Which ones
answered is written to out/tsm_status.json, so we see the day Forever shows up.

The market site uses only what our scans can't give (Joshua, 7 Nov): sales (sold per day, sell rate, average
sale price, from the region file) and prices for items nobody in the guild has scanned (Horde realm file).
Whenever one of those two files changes, they're boiled down into out/tsm.json (see site_file).

Every Horde realm snapshot also goes into a price history for the item chart (Joshua, 20 Nov): out/tsmhist/<YYYY-MM>/<shard>.json
{item id: [[time, min buyout, market value], ...]}, shard = item id % 64 like our own history. It fills the hours
nobody in the guild scanned. The first run builds it from every copy kept since 7 Nov.
"""
import calendar
import csv
import io
import gzip
import hashlib
import time
import urllib.error
import urllib.request

UA = "nrc-market/1 (guild price archive)"


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


SITE_V = 1
SITE_COLS = ["mv", "min", "recent", "hist", "sold", "rate", "avg", "regionMv"]


def _rows(body):
    if not body:
        return {}
    return {r["itemId"]: r for r in csv.DictReader(io.StringIO(body.decode("utf-8", "replace"))) if r.get("itemId", "").isdigit()}


def _int(r, k):
    try:
        return max(int(float(r.get(k) or 0)), 0)
    except ValueError:
        return 0


def _float(r, k, digits):
    try:
        return round(max(float(r.get(k) or 0), 0.0), digits)
    except ValueError:
        return 0


def _stamp(rows):
    times = [r.get("updatedAt") or "" for r in rows.values()]
    t = max(times, default="")
    try:
        return calendar.timegm(time.strptime(t, "%Y-%m-%dT%H:%M:%SZ")) if t else None
    except ValueError:
        return None


def site_file(realm_body, region_body, now):
    """One small file for the site. items: {id: [values in SITE_COLS order]}, copper and per-day numbers.
    mv/min/recent/hist: Horde realm file. sold/rate/avg/regionMv: region file (all of EU, both factions)."""
    realm, region = _rows(realm_body), _rows(region_body)
    items = {}
    for i in sorted(set(realm) | set(region), key=int):
        a, b = realm.get(i, {}), region.get(i, {})
        v = [_int(a, "marketValue"), _int(a, "minBuyout"), _int(a, "recent"), _int(a, "historical"),
             _float(b, "soldPerDay", 1), _float(b, "saleRate", 3), _int(b, "avgSalePrice"), _int(b, "marketValue")]
        if any(v):
            items[i] = v
    return {"built": now, "realmAt": _stamp(realm), "regionAt": _stamp(region), "cols": SITE_COLS, "items": items}


HIST_V = 1
SHARDS = 64


def _shard(item_id):
    return f"{int(item_id) % SHARDS:02x}"


def hist_points(body):
    """realm CSV -> (snapshot time, {item id: [min buyout, market value]}) for items with a price"""
    rows = _rows(body)
    at = _stamp(rows)
    pts = {}
    for i, r in rows.items():
        mn, mv = _int(r, "minBuyout"), _int(r, "marketValue")
        if mn or mv:
            pts[i] = [mn, mv]
    return at, pts


def add_history(store, snapshots):
    """snapshots: [(time, {id: [min, mv]})] -> merged into the month/shard files. Returns files written."""
    by_file = {}
    for at, pts in snapshots:
        if not at:
            continue
        month = time.strftime("%Y-%m", time.gmtime(at))
        for i, (mn, mv) in pts.items():
            by_file.setdefault((month, _shard(i)), {}).setdefault(i, []).append([at, mn, mv])
    for (month, sh), add in by_file.items():
        key = f"out/tsmhist/{month}/{sh}.json"
        cur = store.get_json(key) or {}
        for i, new in add.items():
            seen = {p[0] for p in cur.get(i, [])}
            cur[i] = sorted(cur.get(i, []) + [p for p in new if p[0] not in seen])
        store.put_json(key, cur)
    return len(by_file)


def build_history(store, realm_path):
    """once: every stored copy of the realm file -> history"""
    snaps = []
    for key in sorted(store.list(f"tsm/{realm_path.removesuffix('.csv')}/")):
        if key.endswith(".csv.gz"):
            raw = store.get(key)
            if raw:
                snaps.append(hist_points(gzip.decompress(raw)))
    return add_history(store, snaps)


def targets(cfg):
    paths = list(cfg.get("files", []))
    probe = cfg.get("probe", {})
    for g in probe.get("gameTypes", []):
        for r in probe.get("regions", []):
            for p in probe.get("paths", []):
                path = f"{g}/{r}/{p}"
                if path not in paths:
                    paths.append(path)
    return paths


def run(store, cfg, now=None, fetch=http_get):
    now = int(now or time.time())
    state = store.get_json("tsm/_state.json") or {"hash": {}, "changed": {}}
    stamp = time.strftime("%Y-%m-%d/%H%M", time.gmtime(now))
    status, copied, bodies, changed = {}, 0, {}, set()
    for path in targets(cfg):
        code, body = fetch(cfg["base"].rstrip("/") + "/" + path)
        entry = {"code": code}
        if code == 200 and body:
            h = hashlib.sha256(body).hexdigest()
            if state["hash"].get(path) != h:
                store.put(f"tsm/{path.removesuffix('.csv')}/{stamp}.csv.gz", gzip.compress(body))
                state["hash"][path] = h
                state["changed"][path] = now
                copied += 1
                changed.add(path)
            bodies[path] = body
            entry["bytes"] = len(body)
        entry["lastChange"] = state["changed"].get(path)
        status[path] = entry
    site = cfg.get("site") or {}
    realm = site.get("realm")
    hist = 0
    if realm and state.get("hist_v") != HIST_V:
        hist = build_history(store, realm)            # includes this run's copy
        state["hist_v"] = HIST_V
    elif realm in changed:
        hist = add_history(store, [hist_points(bodies[realm])])
    if site and (changed & set(site.values()) or state.get("site_v") != SITE_V) and all(bodies.get(p) for p in site.values()):
        store.put_json("out/tsm.json", site_file(bodies.get(site.get("realm")), bodies.get(site.get("region")), now))
        state["site_v"] = SITE_V
    store.put_json("tsm/_state.json", state)
    store.put_json("out/tsm_status.json", {"checked": now, "files": status})
    return {"copied": copied, "found": sorted(p for p, e in status.items() if e["code"] == 200), "histFiles": hist}
