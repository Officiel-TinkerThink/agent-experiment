"""Compare two TRAIN runs question by question: both right, one right, agreement of results.

Usage: python3 -I scripts/pair_stats.py <tagA> <tagB> [set]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))
from sqlrun import run  # noqa: E402

a_tag, b_tag = sys.argv[1], sys.argv[2]
set_name = sys.argv[3] if len(sys.argv) > 3 else "train-cv"
A = {r["qid"]: r for r in map(json.loads, open(ROOT / f"data/runs/{a_tag}.{set_name}.jsonl"))}
B = {r["qid"]: r for r in map(json.loads, open(ROOT / f"data/runs/{b_tag}.{set_name}.jsonl"))}
common = sorted(set(A) & set(B))


def result_key(db, sql):
    if not sql:
        return None
    r = run({"db": db, "sql": sql, "max_rows": None, "timeout_s": 60})
    return frozenset(json.dumps(x) for x in r["rows"]) if r["ok"] else None


both = only_a = only_b = neither = 0
agree = agree_right = 0
for q in common:
    a, b = A[q], B[q]
    both += a["correct"] and b["correct"]
    only_a += a["correct"] and not b["correct"]
    only_b += b["correct"] and not a["correct"]
    neither += not a["correct"] and not b["correct"]
    ka, kb = result_key(a["db"], a["sql"]), result_key(b["db"], b["sql"])
    if ka is not None and ka == kb:
        agree += 1
        agree_right += a["correct"]
n = len(common)
print(f"n={n}  A={sum(A[q]['correct'] for q in common)}  B={sum(B[q]['correct'] for q in common)}  "
      f"both={both} onlyA={only_a} onlyB={only_b} neither={neither}  oracle(any)={(both + only_a + only_b) / n * 100:.1f}%")
print(f"results agree on {agree} ({agree / n * 100:.1f}%), of which correct {agree_right} ({agree_right / max(1, agree) * 100:.1f}%); "
      f"disagree on {n - agree}")
