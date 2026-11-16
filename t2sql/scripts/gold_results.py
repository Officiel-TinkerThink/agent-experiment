"""Run every gold SQL of a question file once and cache the results.

Usage: python3 -I scripts/gold_results.py <questions.json> <out.json>
Prints counts only (never question text), so it is safe to run on the sealed test file.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from sqlrun import run  # noqa: E402


def main():
    src, out = sys.argv[1], sys.argv[2]
    items = json.load(open(src))
    results = {}
    errors = 0
    slow = 0
    for it in items:
        t0 = time.monotonic()
        r = run({"db": it["db_id"], "sql": it["SQL"], "max_rows": None, "timeout_s": 120})
        dt = time.monotonic() - t0
        slow += dt > 10
        if not r["ok"]:
            errors += 1
        results[str(it["question_id"])] = r
    json.dump(results, open(out, "w"))
    print(f"questions {len(items)}, gold errors {errors}, slow (>10s) {slow}, written {out}")


if __name__ == "__main__":
    main()
