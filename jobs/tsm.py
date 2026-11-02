"""Copies TSM's public price files into our storage, so we build our own TSM history.

TSM publishes plain CSV snapshots (no key, no limits) at public-data.tradeskillmaster.com. They have no
history, so we keep every version that changed. Forever's file names aren't known until TSM publishes them:
config/tsm.json lists known files plus a few guesses ("probe") that are checked every run. Which ones
answered is written to out/tsm_status.json, so we see the day Forever shows up.
"""
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
    status, copied = {}, 0
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
            entry["bytes"] = len(body)
        entry["lastChange"] = state["changed"].get(path)
        status[path] = entry
    store.put_json("tsm/_state.json", state)
    store.put_json("out/tsm_status.json", {"checked": now, "files": status})
    return {"copied": copied, "found": sorted(p for p, e in status.items() if e["code"] == 200)}
