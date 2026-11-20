"""Icon names for names.json (the site shows wow.zamimg.com/images/wow/icons/<size>/<icon>.jpg).

GuildKit sends each item's icon file ID as the 8th field of a names entry. config/icons.csv turns the file ID
into the icon name, e.g. 132889 -> inv_fabric_linen_01. The list comes from github.com/wowdev/wow-listfile
(parts/interface.csv, only Interface/ICONS) and is committed once; rebuild it when Forever adds new icons:

    python jobs/icons.py --rebuild-list path/to/interface.csv

Backup (Joshua, 5 Nov): items the list can't place (or uploads from GuildKit before 0.13.4, without the field)
are looked up on Wowhead's tooltip data (its Forever database, which also knows every Classic item), a few per run. Answers are remembered; misses are asked again after
a week. Three failures in a row stop the lookups for that run, so a broken address costs seconds, not minutes.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIST = ROOT / "config" / "icons.csv"
CONFIG = ROOT / "config" / "icons.json"
RETRY = 7 * 86400
NAME = re.compile(r"^[a-z0-9_\-]{2,80}$")
UA = "nrc-market/1 (guild price archive)"


def load_list(path=LIST):
    out = {}
    if not Path(path).exists():
        return out
    for line in open(path, encoding="utf-8"):
        fid, _, name = line.strip().partition(",")
        if fid.isdigit() and name:
            out[int(fid)] = name
    return out


def load_config(path=CONFIG):
    return json.loads(Path(path).read_text()) if Path(path).exists() else {}


SELL = re.compile(r'whtt-sellprice">(.*?)</div>', re.S)
COIN = re.compile(r'money(gold|silver|copper)">(\d+)<')


def sell_price(tooltip):
    """Vendor sell price in copper from Wowhead's tooltip HTML, 0 when the item has none (can't be sold)."""
    m = SELL.search(tooltip or "")
    if not m:
        return 0
    mult = {"gold": 10000, "silver": 100, "copper": 1}
    return sum(mult[k] * int(v) for k, v in COIN.findall(m.group(1)))


def wowhead_lookup(url, timeout=10):
    """item id -> (answered, icon or None, name or None, quality or None, vendor sell price in copper or None).
    answered=False: the request failed."""
    def lookup(item_id):
        req = urllib.request.Request(url.format(id=item_id), headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            return (e.code == 404, None, None, None, None)
        except Exception:
            return (False, None, None, None, None)
        if not isinstance(data, dict):
            return (True, None, None, None, None)
        icon = str(data.get("icon") or "").lower()
        name = str(data.get("name") or "").strip()[:120] or None
        q = data.get("quality")
        tip = data.get("tooltip")
        sell = sell_price(tip) if isinstance(tip, str) and tip else None
        return (True, icon if NAME.match(icon) else None, name, q if isinstance(q, int) and 0 <= q <= 7 else None, sell)
    return lookup


def _from_cache(e, hit):
    """Wowhead's answer fills only what the game hasn't sent: the game's name, quality and icon always win."""
    if len(hit) > 2 and hit[2] and "en" not in e:
        e["en"] = hit[2]
        if hit[3] is not None:
            e["q"] = hit[3]
    if hit[1] and "icon" not in e:
        e["icon"] = hit[1]


def fill(names, icon_map, cache, now, lookup=None, per_run=0, seen=(), vend=None):
    """Sets e["icon"] on every names entry it can, and a name for items the game hasn't named yet (Joshua,
    7 Nov). seen: item ids from latest.json, so items without any names entry get one too.
    cache: {item id: [time asked, icon or "", name or "", quality or None]} (Wowhead answers; older entries
    have only the first two). Returns a short summary for the log."""
    from_game = from_cache = asked = found = named = 0
    for item_id, e in names.items():
        icon = icon_map.get(e.get("iconId") or 0)
        if icon:
            from_game += 1
            e["icon"] = icon
        else:
            e.pop("icon", None)
            if cache.get(item_id, [0, ""])[1]:
                from_cache += 1
        if item_id in cache:
            _from_cache(e, cache[item_id])
    for item_id in seen:
        if item_id not in names and item_id in cache and (cache[item_id][1] or (len(cache[item_id]) > 2 and cache[item_id][2])):
            _from_cache(names.setdefault(item_id, {}), cache[item_id])

    def needs(i):
        e = names.get(i, {})
        stale = i not in cache or cache[i][0] < now - RETRY
        # asked before the names were wanted (old cache entry), but the game still hasn't named it
        unasked_name = "en" not in e and i in cache and len(cache[i]) == 2 and cache[i][1]
        return ("icon" not in e or "en" not in e) and (stale or unasked_name)

    fails = 0
    if lookup and per_run > 0:
        todo = [i for i in set(names) | {i for i in seen if str(i).isdigit()} if needs(i)]
        for item_id in sorted(todo, key=lambda i: int(i))[:per_run]:
            ok, icon, name, q, *more = lookup(item_id)
            if ok and more and more[0] is not None and vend is not None:
                vend[item_id] = more[0]
            if not ok:
                fails += 1
                if fails >= 3:
                    break
                continue
            fails = 0
            asked += 1
            cache[item_id] = [now, icon or "", name or "", q]
            if not icon and not name:
                continue
            e = names.setdefault(item_id, {})
            had_icon, had_name = "icon" in e, "en" in e
            _from_cache(e, cache[item_id])
            found += ("icon" in e) and not had_icon
            named += ("en" in e) and not had_name
    seen_set = set(seen) or set(names)
    missing = sum(1 for i in seen_set if "icon" not in names.get(i, {}))
    unnamed = sum(1 for i in seen_set if "en" not in names.get(i, {}))
    return {"fromGame": from_game, "fromWowhead": from_cache + found, "namedByWowhead": named, "asked": asked,
            "missing": missing, "unnamed": unnamed, "stopped": fails >= 3}


def fill_vendor(names, vend, lookup=None, per_run=0, seen=(), prio=None):
    """Vendor sell price (copper) per item: names[id]["sell"]. The game's own value (GuildKit names field 9)
    always wins; Wowhead's Forever tooltip fills the rest (Joshua, 20 Nov). vend: {item id: copper} of answers,
    asked once per item (vendor prices don't change). prio: {item id: listings}, busiest items are asked first.
    Returns a short summary for the log."""
    for item_id, e in names.items():
        if "sell" not in e and item_id in vend:
            e["sell"] = vend[item_id]
    asked = fails = 0
    if lookup and per_run > 0:
        ids = set(seen) | set(names)
        prio = prio or {}
        todo = sorted((i for i in ids if str(i).isdigit() and i not in vend and "sell" not in names.get(i, {})),
                      key=lambda i: (-prio.get(i, 0), int(i)))
        for item_id in todo[:per_run]:
            ok, *rest = lookup(item_id)
            sell = rest[3] if len(rest) > 3 else None
            if not ok or sell is None:
                fails += 0 if ok else 1
                if fails >= 3:
                    break
                continue
            fails = 0
            asked += 1
            vend[item_id] = sell
            if item_id in names and "sell" not in names[item_id]:
                names[item_id]["sell"] = sell
    have = sum(1 for e in names.values() if "sell" in e)
    return {"asked": asked, "withPrice": have, "of": len(names), "stopped": fails >= 3}


def rebuild_list(src, dst=LIST):
    out = {}
    for line in open(src, encoding="utf-8", errors="replace"):
        fid, _, path = line.strip().partition(";")
        m = re.fullmatch(r"interface/icons/([^/]+)\.blp", path, re.I)
        if m and fid.isdigit():
            out[int(fid)] = m.group(1).lower()
    with open(dst, "w", encoding="utf-8") as f:
        f.write("# Icon file ID -> icon name. From github.com/wowdev/wow-listfile (parts/interface.csv, Interface/ICONS only).\n")
        f.write("# Rebuild: python jobs/icons.py --rebuild-list <path to interface.csv>\n")
        for k in sorted(out):
            f.write(f"{k},{out[k]}\n")
    return len(out)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--rebuild-list":
        print(rebuild_list(sys.argv[2]), "icons")
    else:
        print(__doc__)
