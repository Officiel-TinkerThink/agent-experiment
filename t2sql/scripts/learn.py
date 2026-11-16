"""Build the learned layer of the context graph from TRAIN questions only.

Usage: python3 -I scripts/learn.py <fold>     fold = learn (train minus train-dev) | all (all train)
Output: data/graph/<db>.learned.<fold>.json  {concepts, examples}
- concept: one evidence clause, deduplicated, linked to the schema columns it mentions.
- example: question + gold SQL, linked to the columns the SQL uses.
Never reads data/sealed/.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))
from schema_refs import refs_in  # noqa: E402

DBS = ["card_games", "toxicology", "thrombosis_prediction"]


def clauses(evidence: str):
    parts = re.split(r";\s*|\n+", evidence or "")
    return [p.strip().rstrip(".") for p in parts if len(p.strip()) > 3]


def main():
    fold = sys.argv[1]
    train = json.load(open(ROOT / "data/split/train.json"))
    folds = json.load(open(ROOT / "data/split/train_folds.json"))
    if fold == "learn":
        keep = set(folds["learn"])
        train = [d for d in train if d["question_id"] in keep]
    elif fold != "all":
        raise SystemExit("fold must be learn or all (all = every train question; also used for leave-group-out CV)")
    for db in DBS:
        base = json.load(open(ROOT / f"data/graph/{db}.base.json"))
        items = [d for d in train if d["db_id"] == db]
        concepts = {}
        examples = []
        for d in items:
            sql_refs = refs_in(d["SQL"], base)
            examples.append({"id": f"x:{d['question_id']}", "qid": d["question_id"], "question": d["question"],
                             "evidence": d["evidence"], "sql": d["SQL"], "refs": sql_refs})
            for cl in clauses(d["evidence"]):
                key = re.sub(r"\s+", " ", cl.lower())
                c = concepts.setdefault(key, {"id": f"k:{len(concepts)}", "text": cl,
                                              "refs": set(), "support": 0, "sources": []})
                c["support"] += 1
                c["sources"].append(d["question_id"])
                c["refs"].update(refs_in(cl, base) or sql_refs)
        out = {"db": db, "fold": fold,
               "concepts": [{**c, "refs": sorted(c["refs"])} for c in concepts.values()],
               "examples": examples}
        path = ROOT / f"data/graph/{db}.learned.{fold}.json"
        json.dump(out, open(path, "w"), indent=1)
        print(f"{db} [{fold}]: {len(items)} questions -> {len(concepts)} concepts, {len(examples)} examples")


if __name__ == "__main__":
    main()
