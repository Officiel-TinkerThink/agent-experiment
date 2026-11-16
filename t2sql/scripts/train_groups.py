"""Write the near-duplicate group of every TRAIN question (same rule as the split).

Output: data/split/train_groups.json  {question_id: group_index}
Used for leave-group-out evaluation on train: a question never sees its own group's
examples or concepts learned only from its group.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_split import DBS, group  # noqa: E402

train = json.load(open(ROOT / "data/split/train.json"))
out = {}
gid = 0
for db in DBS:
    items = [d for d in train if d["db_id"] == db]
    for g in group(items):
        for i in g:
            out[str(items[i]["question_id"])] = gid
        gid += 1
json.dump(out, open(ROOT / "data/split/train_groups.json", "w"))
print(f"train questions {len(out)}, groups {gid}")
