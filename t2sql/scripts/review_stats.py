"""Effect of the reviewer on TRAIN runs: how often it flagged, and whether changes helped.

Usage: python3 -I scripts/review_stats.py <tag> [set]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))
from sqlrun import run  # noqa: E402

tag = sys.argv[1]
set_name = sys.argv[2] if len(sys.argv) > 2 else "train-cv"
gold = json.load(open(ROOT / "data/split/train_gold.json"))
rows = [json.loads(line) for line in open(ROOT / f"data/runs/{tag}.{set_name}.jsonl")]


def correct(db, sql, qid):
    r = run({"db": db, "sql": sql, "max_rows": None, "timeout_s": 60})
    if not r["ok"]:
        return False
    a = {json.dumps(x) for x in r["rows"]}
    b = {json.dumps(x) for x in gold[str(qid)]["rows"]}
    return a == b


flagged = [r for r in rows if r.get("review") == "FIX"]
changed = [r for r in flagged if r.get("reviewChanged")]
fixed = broke = same = 0
for r in changed:
    t = json.load(open(ROOT / f"data/traces/{tag}/{r['qid']}.json"))
    first = None
    for e in t["trace"]:
        if e.get("retry"):
            break
        for b in e.get("blocks", []):
            if b.get("tool") == "mcp__db__submit_sql":
                first = b["input"]
    was = correct(r["db"], first, r["qid"]) if first else False
    if was and not r["correct"]:
        broke += 1
    elif not was and r["correct"]:
        fixed += 1
    else:
        same += 1
print(f"questions {len(rows)}, reviewer FIX {len(flagged)}, SQL changed {len(changed)}: "
      f"fixed {fixed}, broke {broke}, no effect {same}")
