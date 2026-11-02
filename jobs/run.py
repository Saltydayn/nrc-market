"""Hourly job (GitHub Actions): copy TSM files, then process new scans.

    python jobs/run.py                 uses R2 (env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
    python jobs/run.py --local DIR     works on a local folder instead (testing)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import process  # noqa: E402
import tsm  # noqa: E402
from store import LocalStore, R2Store, WriteCapReached  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MAX_WRITES_PER_RUN = 800      # 24 runs/day x 30 days stays well under R2's 1M free writes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local")
    ap.add_argument("--bucket", default="nrc-market")
    ap.add_argument("--skip-tsm", action="store_true")
    args = ap.parse_args()
    store = LocalStore(args.local, MAX_WRITES_PER_RUN) if args.local else R2Store(args.bucket, MAX_WRITES_PER_RUN)
    try:
        if not args.skip_tsm:
            cfg = json.loads((ROOT / "config" / "tsm.json").read_text())
            print("tsm:", tsm.run(store, cfg))
        print("process:", process.run(store))
    except WriteCapReached as e:
        print("stopped:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
