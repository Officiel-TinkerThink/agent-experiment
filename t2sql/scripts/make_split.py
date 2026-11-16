"""Make the grouped train/test split for the three LCG databases. Run once.

Groups: questions whose gold SQL has the same skeleton (literals removed) or whose question
text is near-identical (token Jaccard >= 0.6) are kept on the same side, so the test set has
no paraphrases of train questions. Split per database, target 146/499 to test.
Train is further split into a learn fold and a train-dev fold (same grouping) for tuning.
Prints counts only. Test goes to data/sealed/ and is not printed.
"""
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEV = ROOT / "data/download/dev_20240627/dev.json"
DBS = ["card_games", "toxicology", "thrombosis_prediction"]
TEST_FRACTION = 146 / 499
TRAIN_DEV_FRACTION = 0.2
SEED = 20261116


def skeleton(sql: str) -> str:
    s = sql.lower()
    s = re.sub(r"'(?:[^']|'')*'", "'?'", s)
    s = re.sub(r"\b\d+(?:\.\d+)?\b", "0", s)
    return re.sub(r"\s+", " ", s).strip()


def qtokens(q: str) -> set:
    q = re.sub(r"'[^']*'|\"[^\"]*\"", " ", q.lower())
    q = re.sub(r"\d+", " ", q)
    return {t for t in re.findall(r"[a-z]+", q) if len(t) > 2}


def group(items):
    parent = list(range(len(items)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        parent[find(a)] = find(b)

    by_skel = defaultdict(list)
    for i, it in enumerate(items):
        by_skel[skeleton(it["SQL"])].append(i)
    for idxs in by_skel.values():
        for j in idxs[1:]:
            union(idxs[0], j)
    toks = [qtokens(it["question"]) for it in items]
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = toks[i], toks[j]
            if a and b and len(a & b) / len(a | b) >= 0.6:
                union(i, j)
    groups = defaultdict(list)
    for i in range(len(items)):
        groups[find(i)].append(i)
    return list(groups.values())


def assign(items, fraction, rng):
    groups = group(items)
    rng.shuffle(groups)
    target = round(len(items) * fraction)
    picked, rest = [], []
    count = 0
    for g in groups:
        if count + len(g) <= target or (count < target and len(g) == 1):
            picked.extend(g)
            count += len(g)
        else:
            rest.extend(g)
    return [items[i] for i in rest], [items[i] for i in picked], len(groups)


def main():
    data = [d for d in json.load(open(DEV)) if d["db_id"] in DBS]
    rng = random.Random(SEED)
    train, test, train_learn, train_dev = [], [], [], []
    for db in DBS:
        items = [d for d in data if d["db_id"] == db]
        tr, te, n_groups = assign(items, TEST_FRACTION, rng)
        learn, dev, _ = assign(tr, TRAIN_DEV_FRACTION, rng)
        train += tr
        test += te
        train_learn += learn
        train_dev += dev
        print(f"{db}: {len(items)} questions, {n_groups} groups -> train {len(tr)} "
              f"(learn {len(learn)}, dev {len(dev)}), test {len(te)}")
    print("total:", len(data), "train", len(train), "test", len(test))
    print("train difficulty:", dict(Counter(d["difficulty"] for d in train)))
    print("test difficulty:", dict(Counter(d["difficulty"] for d in test)))

    split_dir = ROOT / "data/split"
    sealed = ROOT / "data/sealed"
    split_dir.mkdir(parents=True, exist_ok=True)
    sealed.mkdir(parents=True, exist_ok=True)
    if (sealed / "test.json").exists() and "--force" not in sys.argv:
        print("refusing to overwrite an existing split; it is made once")
        return
    json.dump(train, open(split_dir / "train.json", "w"), indent=1)
    json.dump({"learn": [d["question_id"] for d in train_learn],
               "dev": [d["question_id"] for d in train_dev]},
              open(split_dir / "train_folds.json", "w"), indent=1)
    json.dump(test, open(sealed / "test.json", "w"), indent=1)
    print("written: data/split/train.json, data/split/train_folds.json, data/sealed/test.json")


if __name__ == "__main__":
    main()
