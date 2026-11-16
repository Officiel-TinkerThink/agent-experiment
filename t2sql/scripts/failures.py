"""Compact report of wrong answers from TRAIN traces (never use on sealed test traces).

Usage: python3 -I scripts/failures.py <tag> [--db name]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))
from sqlrun import run  # noqa: E402

tag = sys.argv[1]
db_filter = sys.argv[sys.argv.index("--db") + 1] if "--db" in sys.argv else None
tdir = ROOT / "data/traces" / tag
if "sealed" in str(tdir):
    raise SystemExit("refusing: test traces are sealed")


def preview(rows, n=3):
    return "; ".join(str(tuple(r))[:90] for r in rows[:n])


wrong = 0
for f in sorted(tdir.glob("*.json"), key=lambda p: int(p.stem)):
    t = json.loads(f.read_text())
    if t["correct"] or (db_filter and t["db"] != db_filter):
        continue
    wrong += 1
    tools = sum(1 for e in t["trace"] if e["role"] == "assistant" for b in e["blocks"] if "tool" in b)
    print(f"### {t['qid']} [{t['db']}] tools={tools}")
    print(f"Q: {t['question']}")
    print(f"GOLD: {' '.join(t['goldSql'].split())}")
    print(f"  -> {t['goldRows']} rows: {preview(t['goldPreview'])}")
    pred = t["finalSql"]
    print(f"PRED: {' '.join(pred.split()) if pred else None}")
    if pred:
        r = run({"db": t["db"], "sql": pred, "max_rows": 3, "timeout_s": 30})
        print(f"  -> {'ERROR ' + r['error'] if not r['ok'] else str(r['n_rows']) + ' rows: ' + preview(r['rows'])}")
    if t.get("missingCols"):
        print(f"MISSING COLS (never shown): {', '.join(t['missingCols'])}")
    print()
print(f"wrong: {wrong}")
