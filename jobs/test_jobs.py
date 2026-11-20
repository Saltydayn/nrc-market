"""python -m pytest jobs"""
import gzip
import json

import icons
import process
import tsm
from store import LocalStore, WriteCapReached

H = 3600
T0 = 1_793_480_400 // H * H          # an hour start


def upload(store, sid, t, lines, cov=1.0, member="Salty Dayn"):
    scan = {"id": sid, "t": t, "cov": cov, "data": "\n".join(lines), "items": len(lines)}
    day = __import__("time").strftime("%Y-%m-%d/%H", __import__("time").gmtime(t))
    store.put(f"raw/scans/{day}/{sid}.json.gz", gzip.compress(json.dumps(
        {"received": t, "member": member, "scan": scan}).encode()))


def goods(mult=1.0, extra=()):
    rows = [f"{1000 + i},{int(100 * mult)},{int(110 * mult)},{int(120 * mult)},50,5,{int(100 * mult)}*10" for i in range(20)]
    return rows + list(extra)


def test_hour_merge_latest_and_dedupe(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0 + 600, goods(1.0, ["2589,90,95,100,25,2,90*5;100*20"]))
    upload(st, "bbbb-1", T0 + 3000, goods(1.0, ["2589,80,85,90,30,3,80*1;85*29"]), member="Other One")
    r = process.run(st, now=T0 + 2 * H)
    assert r["new_hours"] == 1
    latest = st.get_json("out/latest.json")
    it = latest["items"]["2589"]
    assert it["min"] in (80, 90) and it["seen"] == T0
    assert it["ladder"] == "80*1;85*29"                # the newest scan's ladder
    assert latest["scans24h"] == 2 and latest["contributors24h"] == 2
    hist = st.get_json(f"out/history/{process.day_of(T0)}/{2589 % 64:02x}.json")
    assert str(T0) in hist["2589"]
    # second run: nothing new, no history rewrite
    r = process.run(st, now=T0 + 3 * H)
    assert r["new_hours"] == 0


def test_far_off_scan_is_left_out(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0 + 100, goods(1.0))
    upload(st, "bbbb-1", T0 + 200, goods(1.05), member="B")
    upload(st, "cccc-1", T0 + 300, goods(10.0), member="Cheater")
    process.run(st, now=T0 + 2 * H)
    flags = st.get_json("out/flags.json")
    assert [f["member"] for f in flags] == ["Cheater"]
    assert st.get_json("out/latest.json")["items"]["1000"]["med"] in (120, 126)


def test_change_vs_6h_and_daily_rollup(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0 + 100, goods(1.0))
    process.run(st, now=T0 + H)
    upload(st, "aaaa-2", T0 + 6 * H + 100, goods(1.5))
    process.run(st, now=T0 + 7 * H)
    it = st.get_json("out/latest.json")["items"]["1000"]
    assert it["ch6"] == 0.5
    assert it["pc6"] == 0.5                                            # market price (p10) moved the same way
    month = __import__("time").strftime("%Y-%m", __import__("time").gmtime(T0))
    daily = st.get_json(f"out/daily/{month}.json")
    assert "1000" in daily
    assert len(daily["1000"][process.day_of(T0)]) == 4                 # low, median, units, p10


def test_old_daily_files_get_p10_once(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0 + 100, goods(1.0))
    process.run(st, now=T0 + H)
    month = __import__("time").strftime("%Y-%m", __import__("time").gmtime(T0))
    old = st.get_json(f"out/daily/{month}.json")
    for per_day in old.values():
        for d in per_day:
            per_day[d] = per_day[d][:3]                                # as written before 12 Nov
    st.put_json(f"out/daily/{month}.json", old)
    state = st.get_json("out/_state.json")
    del state["daily_v"]
    st.put_json("out/_state.json", state)
    process.run(st, now=T0 + 2 * H)                                    # no new scans
    assert len(st.get_json(f"out/daily/{month}.json")["1000"][process.day_of(T0)]) == 4


def test_late_upload_for_an_old_hour_is_merged(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0 + 100, goods(1.0))
    process.run(st, now=T0 + H)
    upload(st, "bbbb-1", T0 + 200, goods(1.0, ["9999,5,5,5,1,1"]))    # arrives a day later (archive)
    process.run(st, now=T0 + 25 * H)
    hist = st.get_json(f"out/history/{process.day_of(T0)}/{9999 % 64:02x}.json")
    assert str(T0) in hist["9999"]


def test_old_uploads_are_deleted(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0, goods())
    process.run(st, now=T0 + H)
    r = process.run(st, now=T0 + 31 * 86400)
    assert r["deleted"] == 1 and st.list("raw/scans/") == [] and st.list("out/history/") == []


def test_names_english_only_with_icons(tmp_path):
    st = LocalStore(tmp_path)
    st.put_json("raw/names/deDE/Salty-2026-11-05.json.gz", {"names": {"2589": "Leinenstoff|1|7|5|5|0|200"}})
    st.put_json("raw/names/enUS/Other-2026-11-05-101500.json.gz", {"names": {
        "2589": "Linen Cloth|1|7|5|5|0|200|132889",      # GuildKit 0.13.4+: icon file ID
        "2592": "Wool Cloth|1|7|5|15|0|200",             # older GuildKit: no icon ID -> Wowhead backup
        "9999": "Odd Thing|1|0|0|1|0|1|777"}})           # file ID not in the list, Wowhead doesn't know it
    asked = []
    def lookup(i):
        asked.append(i)
        return (True, {"2592": "inv_fabric_wool_01"}.get(i), None, None)
    process.run(st, now=T0, icon_map={132889: "inv_fabric_linen_01"}, icon_cfg={"wowheadPerRun": 10}, lookup=lookup)
    n = st.get_json("out/names.json")
    assert n["2589"] == {"en": "Linen Cloth", "q": 1, "cls": 7, "sub": 5, "ilvl": 5, "req": 0, "stack": 200,
                         "iconId": 132889, "icon": "inv_fabric_linen_01"}
    assert n["2592"]["icon"] == "inv_fabric_wool_01" and "icon" not in n["9999"]
    assert sorted(asked) == ["2592", "9999"]
    # next run: Wowhead answers are remembered, misses wait a week
    asked.clear()
    process.run(st, now=T0 + H, icon_map={132889: "inv_fabric_linen_01"}, icon_cfg={"wowheadPerRun": 10}, lookup=lookup)
    assert asked == [] and st.get_json("out/names.json")["2592"]["icon"] == "inv_fabric_wool_01"
    process.run(st, now=T0 + 8 * 86400, icon_map={132889: "inv_fabric_linen_01"}, icon_cfg={"wowheadPerRun": 10}, lookup=lookup)
    assert asked == ["9999"]
    # a new Wowhead address asks again right away for what the old one missed, keeps what it found
    asked.clear()
    process.run(st, now=T0 + 8 * 86400 + H, icon_map={132889: "inv_fabric_linen_01"},
                icon_cfg={"wowheadPerRun": 10, "wowhead": "https://example/forever/{id}"}, lookup=lookup)
    assert asked == ["9999"] and st.get_json("out/names.json")["2592"]["icon"] == "inv_fabric_wool_01"


def test_wowhead_names_items_the_game_has_not_named_and_game_wins_later(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "a1", T0 + 60, goods(extra=["249873,500,500,500,3,1,500*3", "277019:-5,900,900,900,1,1,900*1"]))
    wh = {"249873": (True, "inv_drink_21_color01", "Mrrggl Smrrthle", 1),
          "277019": (True, "inv_belt_mail", "Azure Skyforged Chain", 2)}
    lookup = lambda i: wh.get(i, (True, None, None, None))
    process.run(st, now=T0 + H, icon_cfg={"wowheadPerRun": 50}, lookup=lookup)
    n = st.get_json("out/names.json")
    assert n["249873"] == {"en": "Mrrggl Smrrthle", "q": 1, "icon": "inv_drink_21_color01"}
    assert n["277019"]["en"] == "Azure Skyforged Chain" and n["277019"]["q"] == 2
    # the game sends its own name later: the game's wins, Wowhead's icon stays until the game sends one
    st.put_json("raw/names/enUS/Salty-2026-11-08-101500.json.gz", {"names": {"249873": "Mrrggl's Smoothie|1|0|5|10|0|20"}})
    process.run(st, now=T0 + 2 * H, icon_cfg={"wowheadPerRun": 50}, lookup=lookup)
    e = st.get_json("out/names.json")["249873"]
    assert e["en"] == "Mrrggl's Smoothie" and e["cls"] == 0 and e["icon"] == "inv_drink_21_color01"


def test_names_from_same_day_overwrites_are_not_lost(tmp_path):
    st = LocalStore(tmp_path)
    day = process.day_of(T0)
    old = f"raw/names/enUS/Salty-{day}.json.gz"              # before 6 Nov: one file per member and day
    st.put_json(old, {"names": {"2589": "Linen Cloth|1|7|5|5|0|200"}})
    st.put_json("out/names.json", {"2589": {"de": "Leinenstoff"}})
    process.run(st, now=T0)
    assert st.get_json("out/names.json") == {"2589": {"en": "Linen Cloth", "q": 1, "cls": 7, "sub": 5, "ilvl": 5,
                                                       "req": 0, "stack": 200}}   # rebuilt: German gone
    st.put_json(old, {"names": {"2589": "Linen Cloth|1|7|5|5|0|200", "2592": "Wool Cloth|1|7|5|15|0|200"}})
    process.run(st, now=T0 + H)                               # same file, overwritten later that day
    assert set(st.get_json("out/names.json")) == {"2589", "2592"}
    st.put_json(f"raw/names/enUS/Salty-{day}-120000.json.gz", {"names": {"118": "Minor Healing Potion|1|0|0|5|1|5"}})
    process.run(st, now=T0 + 2 * H)
    assert set(st.get_json("out/names.json")) == {"2589", "2592", "118"}
    process.run(st, now=T0 + 32 * 86400)                      # raw name files go after 30 days, names stay
    assert st.list("raw/names/") == [] and len(st.get_json("out/names.json")) == 3


def test_german_scans_already_stored_are_skipped(tmp_path):
    st = LocalStore(tmp_path)
    upload(st, "aaaa-1", T0 + 600, goods(1.0))
    scan = {"id": "dddd-1", "t": T0 + 900, "cov": 1, "locale": "deDE", "data": "2589,1,1,1,1,1", "items": 1}
    st.put(f"raw/scans/{process.day_of(T0)}/xx/dddd-1.json.gz", gzip.compress(json.dumps(
        {"received": T0, "member": "De", "scan": scan}).encode()))
    process.run(st, now=T0 + 2 * H)
    latest = st.get_json("out/latest.json")
    assert "2589" not in latest["items"] and latest["scans24h"] == 1


def test_tsm_copies_only_changed_files_and_reports_probes(tmp_path):
    st = LocalStore(tmp_path)
    cfg = {"base": "https://x", "files": ["retail/eu/commodities.csv"],
           "probe": {"gameTypes": ["forever"], "regions": ["eu"], "paths": ["region/items.csv"]}}
    body = {"https://x/retail/eu/commodities.csv": b"itemId,minBuyout\n2589,100\n"}
    fetch = lambda url: (200, body[url]) if url in body else (404, None)
    r = tsm.run(st, cfg, now=T0, fetch=fetch)
    assert r == {"copied": 1, "found": ["retail/eu/commodities.csv"]}
    r = tsm.run(st, cfg, now=T0 + H, fetch=fetch)
    assert r["copied"] == 0                              # unchanged: not stored again
    body["https://x/forever/eu/region/items.csv"] = b"itemId,marketValue\n1,2\n"
    r = tsm.run(st, cfg, now=T0 + 2 * H, fetch=fetch)
    assert r["copied"] == 1 and "forever/eu/region/items.csv" in r["found"]
    status = st.get_json("out/tsm_status.json")
    assert status["files"]["forever/eu/region/items.csv"]["code"] == 200
    assert len([k for k in st.list("tsm/") if k.endswith(".csv.gz")]) == 2


def test_tsm_site_file_only_when_its_files_change(tmp_path):
    st = LocalStore(tmp_path)
    realm, region = "forever/eu/realm/normal-horde/items.csv", "forever/eu/region/items.csv"
    cfg = {"base": "https://x", "files": [realm, region], "site": {"realm": realm, "region": region}}
    body = {
        "https://x/" + realm: b"itemId,name,marketValue,minBuyout,recent,historical,updatedAt\n"
                              b"2589,Linen Cloth,24,24,25,25,2026-11-07T05:12:10Z\n934,Stalvan's Reaper,50000,0,0,50000,2026-11-07T05:12:10Z\n",
        "https://x/" + region: b"itemId,name,marketValue,historical,avgSalePrice,saleRate,soldPerDay,updatedAt\n"
                               b"2589,Linen Cloth,24,25,30,0.796,7635.63,2026-11-06T02:04:51Z\n4306,Silk Cloth,837,872,225,0.812,287.854,2026-11-06T02:04:51Z\n",
    }
    fetch = lambda url: (200, body[url]) if url in body else (404, None)
    tsm.run(st, cfg, now=T0, fetch=fetch)
    f = st.get_json("out/tsm.json")
    assert f["cols"] == ["mv", "min", "recent", "hist", "sold", "rate", "avg", "regionMv"]
    assert f["items"]["2589"] == [24, 24, 25, 25, 7635.6, 0.796, 30, 24]
    assert f["items"]["934"] == [50000, 0, 0, 50000, 0, 0, 0, 0]          # Horde only
    assert f["items"]["4306"] == [0, 0, 0, 0, 287.9, 0.812, 225, 837]     # region only
    assert f["realmAt"] == 1794028330 and f["built"] == T0
    tsm.run(st, cfg, now=T0 + H, fetch=fetch)                               # nothing changed: not rewritten
    assert st.get_json("out/tsm.json")["built"] == T0
    # Horde-only TSM items get a name + icon from Wowhead, like our own items
    process.run(st, now=T0 + H, icon_cfg={"wowheadPerRun": 10},
                lookup=lambda i: (True, "inv_axe_09", "Stalvan's Reaper", 2) if i == "934" else (True, None, None, None))
    assert st.get_json("out/names.json")["934"]["en"] == "Stalvan's Reaper"
    assert "4306" not in st.get_json("out/names.json")


def test_write_cap_stops_the_run(tmp_path):
    st = LocalStore(tmp_path, max_writes=3)
    upload_store = LocalStore(tmp_path)
    for i in range(5):
        upload(upload_store, f"aaaa-{i}", T0 + i * H, [f"{i},1,1,1,1,1"])
    try:
        process.run(st, now=T0 + 6 * H)
        assert False, "should stop"
    except WriteCapReached:
        pass


def test_vendor_price_from_wowhead_tooltip():
    tip = '<div class="whtt-sellprice">Sell Price: <span class="moneygold">1</span> <span class="moneysilver">2</span> <span class="moneycopper">3</span></div>'
    assert icons.sell_price(tip) == 10203
    assert icons.sell_price('<div class="whtt-sellprice">Sell Price: <span class="moneysilver">5</span></div>') == 500
    assert icons.sell_price("<table>no price</table>") == 0


def test_vendor_fill_game_wins_and_asks_once():
    names = {"8170": {"en": "Rugged Leather"}, "2589": {"en": "Linen Cloth", "sell": 13}}
    vend = {}
    asked = []
    def lookup(i):
        asked.append(i)
        return (True, None, None, None, {"8170": 500, "2589": 99, "999": 0}[i])
    r = icons.fill_vendor(names, vend, lookup, per_run=10, seen={"999"})
    assert names["8170"]["sell"] == 500
    assert names["2589"]["sell"] == 13            # the game's value stays
    assert vend == {"8170": 500, "999": 0} and r["asked"] == 2
    icons.fill_vendor(names, vend, lookup, per_run=10, seen={"999"})
    assert len(asked) == 2                         # never asked again


def test_vendor_asks_busiest_items_first():
    names = {"25": {}, "273128": {}}
    asked = []
    lookup = lambda i: (asked.append(i), (True, None, None, None, 100))[1]
    icons.fill_vendor(names, {}, lookup, per_run=1, prio={"273128": 96, "25": 2})
    assert asked == ["273128"]
