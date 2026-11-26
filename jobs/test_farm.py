"""python -m pytest jobs"""
import json
import time

import farm
from store import LocalStore

NOW = 1_795_600_000
TODAY = time.strftime("%Y-%m-%d", time.gmtime(NOW))
OLD_DAY = time.strftime("%Y-%m-%d", time.gmtime(NOW - 40 * 86400))


def export(pid, t=NOW - 600, **over):
    x = {"format": "nrc-farm/1", "rev": 1, "t": t, "pid": pid, "ver": "0.14.0", "locale": "enUS",
         "guild": "Naga Rave Cave", "main": "", "chars": {}, "mobs": "", "nodes": "", "runs": "", "farms": "", "days": {}}
    x.update(over)
    return x


def put(store, x):
    store.put(f"farm/in/{x['pid']}.json", json.dumps({"received": x["t"], "member": "m", "export": x}).encode())


def parse(store):
    text = store.get("farm/guild.txt").decode()
    rows = [line.split("|") for line in text.strip("\n").split("\n")]
    return rows[0], {k: [r for r in rows[1:] if r[0] == k] for k in "CMNRFD"}


def guild(tmp_path):
    """Three accounts: Joshua (English, with his Blackthornes book), a German one, and one with a cheated mob line."""
    st = LocalStore(tmp_path)
    put(st, export("aaaaaaaaaaaa", main="Saltydayn Nagaqt",
                   chars={"Saltydayn Nagaqt": "ROGUE,60", "Olli Nagaqt": "WARLOCK,32"},
                   mobs="\n".join([
                       "1001|Blackrock Soldier|58|elite|1|40|1200|39|38|190000|0|8846:6:5;14047:30:20|",
                       "1002|Plainstrider|12|normal||10|300|9|10|500|7|5469:4:4|4232:7",
                   ]),
                   nodes="mine:2770|Copper Vein|12|2770:30;2835:10",
                   runs="229|Blackrock Spire|3|10800|9000000|300|4000000",
                   farms="\n".join([
                       "dungeon|Saltydayn Nagaqt|1795500000|3600|3000000|1000000|UBRS|Blackrock Mountain|12360:1",
                       "leather|Olli Nagaqt|1795400000|1500|200000|50000|Leder|Feralas|4304:20",
                   ]),
                   days={TODAY: {"Saltydayn Nagaqt": "3600,3000000,1000000,500000,300,0,0,0,0,3000000,1,3000000"},
                         OLD_DAY: {"Saltydayn Nagaqt": "100,1,1,1,1,0,0,0,0,1,0,0"}}))
    put(st, export("bbbbbbbbbbbb", locale="deDE", main="Bruni Eisenfaust",
                   chars={"Bruni Eisenfaust": "WARRIOR,60"},
                   mobs="1001|Schwarzfelssoldat|60|elite|1|20|600|19|20|100000|0|8846:2:2|",
                   nodes="mine:2770|Kupferader|8|2770:20",
                   farms="dungeon|Bruni Eisenfaust|1795450000|7200|4000000|1500000|UBRS|Schwarzfels|",
                   days={TODAY: {"Bruni Eisenfaust": "0,0,0,0,0,0,0,0,0,0,0,0"}}))
    put(st, export("cccccccccccc", main="Saltydayn Nagaqt",       # tries to take Joshua's main, plus a cheat
                   chars={"Saltydayn Nagaqt": "ROGUE,60", "Kira Schatten": "MAGE,50"},
                   mobs="\n".join([
                       "1001|Blackrock Soldier|58|elite|1|5|500|4|5|99000000|0||",          # 198 g per corpse
                       "1002|Plainstrider|12|normal||5|150|4|5|250|0|5469:2:2|",
                       "1003|Kobold|5|normal||5|2|4|5|10|0||",                              # 0.5 s per kill
                       "garbage line",
                   ]),
                   days={TODAY: {"Saltydayn Nagaqt": "9999,1,1,1,1,1,1,1,1,1,1,1",
                                 "Kira Schatten": "1800,100,100,100,5,0,0,0,0,100,0,0"}}))
    return st


def test_merge_guild_file(tmp_path):
    st = guild(tmp_path)
    r = farm.run(st, now=NOW)
    assert r["built"] and r["players"] == 3
    assert r["outliers"] == 2 and r["broken"] == 1
    head, rows = parse(st)
    assert head == ["nrc-farm-guild/1", str(NOW), "3"]

    chars = {c[1]: c for c in rows["C"]}
    assert chars["Saltydayn Nagaqt"][2:] == ["aaaaaaaaaaaa", "Saltydayn Nagaqt", "ROGUE", "60"]
    assert chars["Olli Nagaqt"][3] == "Saltydayn Nagaqt"
    assert chars["Kira Schatten"][2:4] == ["cccccccccccc", ""]        # its main belongs to someone else: dropped
    assert chars["Bruni Eisenfaust"][2] == "bbbbbbbbbbbb"

    mobs = {m[1]: m for m in rows["M"]}
    soldier = mobs["1001"]                                           # Joshua + the German, the cheat line is gone
    assert soldier[2:13] == ["60", "elite", "1", "60", "1800", "58", "58", "290000", "0", "2", soldier[12]]
    assert soldier[12] == "14047:30:20;8846:8:7"
    assert soldier[14:] == ["Blackrock Soldier", "Schwarzfelssoldat"]
    assert mobs["1002"][5] == "15" and mobs["1002"][11] == "2"      # the cheater's honest line still counts
    assert mobs["1002"][13] == "4232:7"
    assert "1003" not in mobs

    node = rows["N"][0]
    assert node == ["N", "mine:2770", "20", "2", "2770:50;2835:10", "Copper Vein", "Kupferader"]
    assert rows["R"][0] == ["R", "229", "3", "10800", "9000000", "300", "4000000", "1", "Blackrock Spire", ""]

    farms = [(f[1], f[2]) for f in rows["F"]]
    assert farms == [("dungeon", "Saltydayn Nagaqt"), ("dungeon", "Bruni Eisenfaust"), ("leather", "Olli Nagaqt")]

    days = [(d[1], d[2]) for d in rows["D"]]
    assert days == [("Kira Schatten", TODAY), ("Saltydayn Nagaqt", TODAY)]   # no zero days, no old days, no stolen chars
    assert rows["D"][1][3].startswith("3600,")

    assert st.get_json("farm/_state.json")["claims"]["Saltydayn Nagaqt"] == "aaaaaaaaaaaa"


def test_builds_only_when_something_new(tmp_path):
    st = guild(tmp_path)
    assert farm.run(st, now=NOW)["built"]
    assert farm.run(st, now=NOW + 3600) == {"built": False, "why": "nothing new"}
    assert farm.run(st, now=NOW + 86400 + 1)["built"]                        # once a day anyway
    assert farm.run(LocalStore(tmp_path / "empty"), now=NOW) == {"built": False, "why": "no uploads"}


def test_skips_other_guilds_and_old_exports(tmp_path):
    st = LocalStore(tmp_path)
    put(st, export("aaaaaaaaaaaa", guild="Somebody Else", mobs="1|X|1|normal||1|0|0|1|1|0||"))
    put(st, export("bbbbbbbbbbbb", t=NOW - 61 * 86400, mobs="1|X|1|normal||1|0|0|1|1|0||"))
    put(st, export("cccccccccccc", mobs="1|X|1|normal||1|0|0|1|1|0||"))
    r = farm.run(st, now=NOW)
    assert r["skipped"] == {"guild": 1, "old": 1} and r["players"] == 1


def test_claims_are_kept_and_released(tmp_path):
    st = LocalStore(tmp_path)
    put(st, export("bbbbbbbbbbbb", t=NOW - 900, chars={"Kira Schatten": "MAGE,50"}))
    farm.run(st, now=NOW)
    put(st, export("aaaaaaaaaaaa", t=NOW - 100, chars={"Kira Schatten": "MAGE,51"}))   # later claim: dropped
    farm.run(st, now=NOW + 60, force=True)
    _, rows = parse(st)
    assert [c[2] for c in rows["C"]] == ["bbbbbbbbbbbb"]
    (tmp_path / "farm/in/bbbbbbbbbbbb.json").unlink()                                   # owner gone: free again
    farm.run(st, now=NOW + 120, force=True)
    _, rows = parse(st)
    assert [c[2] for c in rows["C"]] == ["aaaaaaaaaaaa"]


def test_names_are_cleaned():
    assert farm.clean("Bad|Name\n\x07" + "x" * 60) == "BadName" + "x" * 41
    assert farm.clean("Schwarzfels·Späher") == "Schwarzfels·Späher"
    assert farm.clean(None) == ""


def test_farm_board_keeps_top_per_type_and_each_chars_best(tmp_path):
    st = LocalStore(tmp_path)
    many = "\n".join(f"ore|Miner Nagaqt|{1795000000 + i}|3600|{1000 * (i + 1)}|0|Erz|Zone|" for i in range(40))
    put(st, export("aaaaaaaaaaaa", chars={"Miner Nagaqt": "WARRIOR,60", "Slow Nagaqt": "ROGUE,40"},
                   farms=many + "\nore|Slow Nagaqt|1795000000|1300|10|0|Erz|Zone|"))
    farm.run(st, now=NOW)
    _, rows = parse(st)
    ore = [f for f in rows["F"] if f[1] == "ore"]
    assert len(ore) == 31                                   # 30 best + Slow's only (short) session
    assert ore[0][5] == "40000" and ore[-1][2] == "Slow Nagaqt"
