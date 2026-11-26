"""Farm tracker guild file: merges every member's GuildKit_Farm export into one text file for the game.

    farm/in/<pid>.json   latest export of one WoW account folder (intake Worker, POST /v1/farm)
    farm/guild.txt       the merged guild file (intake Worker serves it, GET /v1/farm)
    farm/_state.json     which pid owns which character, when the file was last built

Built only when a farm upload arrived since the last build, or once a day (days roll over).
Numbers are self-reported and cosmetic (leaderboards, mob book), never tied to loot or points.
"""
import json
import re
import time
import unicodedata
from collections import Counter, defaultdict

GUILD = "Naga Rave Cave"
EXPORT = "nrc-farm/1"
HEAD = "nrc-farm-guild/1"
MAX_AGE = 60 * 86400            # exports older than this are left out
DAYS = 35                       # day lines kept per character
EVERY = 86400                   # rebuild at least once a day
GOLD = 10000                    # copper
MOB_COIN_MAX = 50 * GOLD        # coin per looted corpse above this = outlier
MOB_QTY_MAX = 50                # items of one kind per corpse above this = outlier
MOB_ITEMS = 25                  # biggest drops kept per mob
FARM_TOP = 30                   # best sessions kept per farm type
FARM_MIN = 1800                 # ...counting sessions of 30 min or more
MAX_BYTES = 3_800_000           # NRC Sync refuses files of 4 MB or more
LANG = {"enUS": "en", "deDE": "de"}
FARM_TYPES = {"leather", "ore", "herbs", "cloth", "mobs", "dungeon", "recipe", "mixed"}
NODE_KEY = re.compile(r"^(mine|herb|fish):\d+$")
DAY_KEY = re.compile(r"^\d{4}-\d\d-\d\d$")
DIGITS = re.compile(r"^\d+$")
CLASS = re.compile(r"^[A-Z]{0,16}$")
MOB_CLASSES = {"elite", "normal", "rare", "rareelite", "worldboss"}


class Broken(Exception):
    pass


def clean(text):
    """Names end up in other people's game: printable only, no | (WoW's escape character), 48 characters at most."""
    if not isinstance(text, str):
        return ""
    text = "".join(ch for ch in text if ch != "|" and not unicodedata.category(ch).startswith("C"))
    return text.strip()[:48]


def num(v):
    if not isinstance(v, str) or not DIGITS.match(v):
        raise Broken(v)
    return int(v)


def items(text, drops=False):
    """'id:qty;...' (drops: 'id:qty:drops;...') -> {id: [qty, drops]}"""
    out = {}
    for part in (text or "").split(";"):
        if not part:
            continue
        f = part.split(":")
        if len(f) != (3 if drops else 2):
            raise Broken(part)
        out[num(f[0])] = [num(f[1]), num(f[2]) if drops else 0]
    return out


def item_text(d, drops=False, top=None):
    ids = sorted(d, key=lambda i: (-d[i][0], i))[:top]
    return ";".join(f"{i}:{d[i][0]}:{d[i][1]}" if drops else f"{i}:{d[i][0]}" for i in ids if d[i][0] > 0)


def lines(text, width):
    """Split one export field into lines of `width` fields; broken lines are skipped (counted)."""
    out, bad = [], 0
    for line in (text or "").split("\n"):
        if not line:
            continue
        f = line.split("|")
        if len(f) != width:
            bad += 1
            continue
        out.append(f)
    return out, bad


def load(store, now):
    """All usable exports, oldest first: [(pid, export)] plus counts of what was skipped."""
    got, skipped = [], Counter()
    for key in store.list("farm/in/"):
        try:
            rec = store.get_json(key)
            x = rec["export"]
        except Exception:
            skipped["unreadable"] += 1
            continue
        if not isinstance(x, dict) or x.get("format") != EXPORT or not isinstance(x.get("pid"), str):
            skipped["format"] += 1
        elif x.get("guild") != GUILD:
            skipped["guild"] += 1
        elif not isinstance(x.get("t"), int) or x["t"] < now - MAX_AGE:
            skipped["old"] += 1
        else:
            got.append((x["pid"], x))
    got.sort(key=lambda p: (p[1]["t"], p[0]))
    return got, skipped


def account_chars(x):
    """Every character an export names: its chars table plus whoever shows up in days or farms."""
    names = {}
    for name, cl in (x.get("chars") or {}).items():
        cls, _, lv = (cl if isinstance(cl, str) else "").partition(",")
        names[clean(name)] = (cls if CLASS.match(cls) else "", int(lv) if DIGITS.match(lv) else 0)
    for chars in (x.get("days") or {}).values():
        for name in (chars if isinstance(chars, dict) else {}):
            names.setdefault(clean(name), ("", 0))
    for f in lines(x.get("farms"), 9)[0]:
        names.setdefault(clean(f[1]), ("", 0))
    names.pop("", None)
    return names


def claim(exports, state, log):
    """Each character belongs to the pid that claimed it first. Claims of pids that are gone are released."""
    claims = state.setdefault("claims", {})
    live = {pid for pid, _ in exports}
    for char in [c for c, pid in claims.items() if pid not in live]:
        del claims[char]
    for pid, x in exports:
        for char in account_chars(x):
            owner = claims.setdefault(char, pid)
            if owner != pid:
                log.append(f"{char}: claimed by {owner}, {pid} dropped")
    return claims


class Book:
    """Sums one kind of line (mobs, nodes or dungeons) over all accounts."""

    def __init__(self):
        self.rows = {}

    def row(self, key):
        if key not in self.rows:
            self.rows[key] = {"sum": Counter(), "best": 0, "level": 0, "cls": Counter(), "dg": False, "pids": set(),
                              "items": defaultdict(lambda: [0, 0]), "skin": defaultdict(lambda: [0, 0]),
                              "names": {"en": Counter(), "de": Counter()}}
        return self.rows[key]

    @staticmethod
    def name(r, lang, text):
        text = clean(text)
        if lang and text:
            r["names"][lang][text] += 1

    @staticmethod
    def top_name(r, lang):
        c = r["names"][lang]
        return min(c, key=lambda n: (-c[n], n)) if c else ""


def mob(f):
    """Checks one mob line. Returns its numbers or raises Broken / ValueError (outlier)."""
    v = {k: num(f[i]) for i, k in ((2, "level"), (5, "kills"), (6, "cy"), (7, "cn"), (8, "loots"), (9, "coin"), (10, "skinned"))}
    v["npc"] = num(f[0])
    v["items"], v["skin"] = items(f[11], drops=True), items(f[12])
    per = max(v["loots"], 1)
    if v["coin"] / per > MOB_COIN_MAX or any(q / per > MOB_QTY_MAX for q, _ in v["items"].values()):
        raise ValueError("outlier")
    if any(q / max(v["skinned"], 1) > MOB_QTY_MAX for q, _ in v["skin"].values()):
        raise ValueError("outlier")
    if v["cn"] > 0 and v["cy"] < v["cn"]:          # under 1 s per kill
        raise ValueError("outlier")
    return v


def merge(exports, claims, now):
    mobs, nodes, runs = Book(), Book(), Book()
    farms, days, chars, stats = [], [], [], Counter()
    cut = time.strftime("%Y-%m-%d", time.gmtime(now - (DAYS - 1) * 86400))
    used = set()

    for pid, x in exports:
        lang = LANG.get(x.get("locale"))
        mine = {c for c, owner in claims.items() if owner == pid}
        main = clean(x.get("main"))
        main = main if main in mine else ""
        for char, (cls, lv) in sorted(account_chars(x).items()):
            if char in mine:
                chars.append(["C", char, pid, main, cls, str(lv)])

        found, bad = lines(x.get("mobs"), 13)
        stats["broken"] += bad
        for f in found:
            try:
                v = mob(f)
            except Broken:
                stats["broken"] += 1
                continue
            except ValueError:
                stats["outliers"] += 1
                continue
            r = mobs.row(v["npc"])
            for k in ("kills", "cy", "cn", "loots", "coin", "skinned"):
                r["sum"][k] += v[k]
            r["level"] = max(r["level"], v["level"])
            if f[3] in MOB_CLASSES:
                r["cls"][f[3]] += 1
            r["dg"] = r["dg"] or f[4] == "1"
            for i, (q, d) in v["items"].items():
                r["items"][i][0] += q
                r["items"][i][1] += d
            for i, (q, _) in v["skin"].items():
                r["skin"][i][0] += q
            r["pids"].add(pid)
            Book.name(r, lang, f[1])
            used.add(pid)

        found, bad = lines(x.get("nodes"), 4)
        stats["broken"] += bad
        for f in found:
            try:
                if not NODE_KEY.match(f[0]):
                    raise Broken(f[0])
                times, its = num(f[2]), items(f[3])
            except Broken:
                stats["broken"] += 1
                continue
            r = nodes.row(f[0])
            r["sum"]["times"] += times
            for i, (q, _) in its.items():
                r["items"][i][0] += q
            r["pids"].add(pid)
            Book.name(r, lang, f[1])
            used.add(pid)

        found, bad = lines(x.get("runs"), 7)
        stats["broken"] += bad
        for f in found:
            try:
                inst, vals = num(f[0]), [num(f[i]) for i in range(2, 7)]
            except Broken:
                stats["broken"] += 1
                continue
            r = runs.row(inst)
            for k, val in zip(("runs", "secs", "value", "kills"), vals):
                r["sum"][k] += val
            r["best"] = max(r["best"], vals[4])
            r["pids"].add(pid)
            Book.name(r, lang, f[1])
            used.add(pid)

        found, bad = lines(x.get("farms"), 9)
        stats["broken"] += bad
        for f in found:
            char = clean(f[1])
            try:
                start, secs, value, raw = (num(f[i]) for i in range(2, 6))
                its = items(f[8])
            except Broken:
                stats["broken"] += 1
                continue
            if f[0] not in FARM_TYPES or char not in mine or secs <= 0:
                continue
            farms.append({"type": f[0], "char": char, "start": start, "secs": secs, "value": value, "raw": raw,
                          "name": clean(f[6]), "zone": clean(f[7]), "items": item_text(its), "gph": value * 3600 / secs})
            used.add(pid)

        for d, per in (x.get("days") or {}).items():
            if not isinstance(d, str) or not DAY_KEY.match(d) or d < cut or not isinstance(per, dict):
                continue
            for name, csv in per.items():
                char = clean(name)
                vals = csv.split(",") if isinstance(csv, str) else []
                if char not in mine or len(vals) != 12 or not all(DIGITS.match(v) for v in vals):
                    stats["broken"] += char in mine
                    continue
                if int(vals[0]) > 0:
                    days.append(["D", char, d, ",".join(str(int(v)) for v in vals)])
                    used.add(pid)

    return {"mobs": mobs, "nodes": nodes, "runs": runs, "farms": farms, "days": days, "chars": chars,
            "players": len(used), "stats": stats}


def best_farms(farms):
    """Per type the 30 best by gold/h (30 min or more), plus each character's best per type."""
    keep = {}
    by_type = defaultdict(list)
    for fm in farms:
        by_type[fm["type"]].append(fm)
    for typ, lst in by_type.items():
        lst.sort(key=lambda fm: (-fm["gph"], fm["char"], fm["start"]))
        for fm in [fm for fm in lst if fm["secs"] >= FARM_MIN][:FARM_TOP]:
            keep[(typ, fm["char"], fm["start"])] = fm
        seen = set()
        for fm in lst:
            if fm["char"] not in seen:
                seen.add(fm["char"])
                keep[(typ, fm["char"], fm["start"])] = fm
    return sorted(keep.values(), key=lambda fm: (fm["type"], -fm["gph"], fm["char"], fm["start"]))


def render(m, now):
    out = [[HEAD, str(now), str(m["players"])]]
    out += sorted(m["chars"], key=lambda c: c[1])
    for npc, r in sorted(m["mobs"].rows.items()):
        s = r["sum"]
        cls = min(r["cls"], key=lambda c: (-r["cls"][c], c)) if r["cls"] else ""
        out.append(["M", str(npc), str(r["level"]), cls, "1" if r["dg"] else "", str(s["kills"]), str(s["cy"]),
                    str(s["cn"]), str(s["loots"]), str(s["coin"]), str(s["skinned"]), str(len(r["pids"])),
                    item_text(r["items"], drops=True, top=MOB_ITEMS), item_text(r["skin"], top=MOB_ITEMS),
                    Book.top_name(r, "en"), Book.top_name(r, "de")])
    for key, r in sorted(m["nodes"].rows.items()):
        out.append(["N", key, str(r["sum"]["times"]), str(len(r["pids"])), item_text(r["items"]),
                    Book.top_name(r, "en"), Book.top_name(r, "de")])
    for inst, r in sorted(m["runs"].rows.items()):
        s = r["sum"]
        out.append(["R", str(inst), str(s["runs"]), str(s["secs"]), str(s["value"]), str(s["kills"]), str(r["best"]),
                    str(len(r["pids"])), Book.top_name(r, "en"), Book.top_name(r, "de")])
    for fm in best_farms(m["farms"]):
        out.append(["F", fm["type"], fm["char"], str(fm["start"]), str(fm["secs"]), str(fm["value"]), str(fm["raw"]),
                    fm["name"], fm["zone"], fm["items"]])
    out += sorted(m["days"], key=lambda d: (d[1], d[2]))
    return "\n".join("|".join(f) for f in out) + "\n"


def run(store, now=None, force=False):
    now = int(now or time.time())
    state = store.get_json("farm/_state.json") or {}
    files = store.list_meta("farm/in/")
    if not files:
        return {"built": False, "why": "no uploads"}
    newest = max(t for _, t in files)
    if not force and newest <= state.get("seen", 0) and now - state.get("built", 0) < EVERY:
        return {"built": False, "why": "nothing new"}

    exports, skipped = load(store, now)
    log = []
    claims = claim(exports, state, log)
    m = merge(exports, claims, now)
    text = render(m, now)
    size = len(text.encode("utf-8"))
    for line in log:
        print("farm:", line)
    if size >= MAX_BYTES:
        print(f"farm: guild file would be {size} bytes, too big for NRC Sync; old file kept")
        return {"built": False, "why": "too big", "bytes": size}
    store.put("farm/guild.txt", text.encode("utf-8"))
    state.update(seen=newest, built=now, log=(state.get("log", []) + log)[-50:])
    store.put_json("farm/_state.json", state)
    return {"built": True, "players": m["players"], "mobs": len(m["mobs"].rows), "bytes": size,
            "skipped": dict(skipped), **dict(m["stats"])}
