"""Copies TSM's public price files into our storage, so we build our own TSM history.

TSM publishes plain CSV snapshots (no key, no limits) at public-data.tradeskillmaster.com. They have no
history, so we keep every version that changed. Forever's file names aren't known until TSM publishes them:
config/tsm.json lists known files plus a few guesses ("probe") that are checked every run. Which ones
answered is written to out/tsm_status.json, so we see the day Forever shows up.

The market site uses only what our scans can't give (Joshua, 7 Nov): sales (sold per day, sell rate, average
sale price, from the region file) and prices for items nobody in the guild has scanned (Horde realm file).
Whenever one of those two files changes, they're boiled down into out/tsm.json (see site_file).
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
    if site and (changed & set(site.values()) or state.get("site_v") != SITE_V) and all(bodies.get(p) for p in site.values()):
        store.put_json("out/tsm.json", site_file(bodies.get(site.get("realm")), bodies.get(site.get("region")), now))
        state["site_v"] = SITE_V
    store.put_json("tsm/_state.json", state)
    store.put_json("out/tsm_status.json", {"checked": now, "files": status})
    return {"copied": copied, "found": sorted(p for p, e in status.items() if e["code"] == 200)}
