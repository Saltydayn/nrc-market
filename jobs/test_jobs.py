"""python -m pytest jobs"""
import gzip
import json

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
    month = __import__("time").strftime("%Y-%m", __import__("time").gmtime(T0))
    daily = st.get_json(f"out/daily/{month}.json")
    assert "1000" in daily


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


def test_names_are_merged_german_and_english(tmp_path):
    st = LocalStore(tmp_path)
    st.put_json("raw/names/deDE/Salty-2026-11-05.json.gz", {"names": {"2589": "Leinenstoff|1|7|5|5|0|200"}})
    st.put_json("raw/names/enUS/Other-2026-11-05.json.gz", {"names": {"2589": "Linen Cloth|1|7|5|5|0|200"}})
    process.run(st, now=T0)
    n = st.get_json("out/names.json")["2589"]
    assert n["de"] == "Leinenstoff" and n["en"] == "Linen Cloth" and n["stack"] == 200


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
