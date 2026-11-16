"""Probe TRAIN gold SQL for per-database conventions (counting style, which date column)."""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
train = json.load(open(ROOT / "data/split/train.json"))
for db in ["card_games", "toxicology", "thrombosis_prediction"]:
    items = [d for d in train if d["db_id"] == db]
    hm = [d for d in items if re.search(r"\bhow many\b", d["question"], re.I)]
    distinct = sum(1 for d in hm if re.search(r"COUNT\s*\(\s*DISTINCT", d["SQL"], re.I))
    print(f"{db}: 'how many' questions {len(hm)}, with COUNT(DISTINCT) {distinct}, without {len(hm) - distinct}")
    if db == "thrombosis_prediction":
        ex = [d for d in items if re.search(r"exam", d["question"], re.I) and re.search(r"date|\d{4}", d["question"], re.I)]
        c = Counter()
        for d in ex:
            uses_lab = "laboratory" in d["SQL"].lower() and re.search(r"\.?\bdate\b", d["SQL"], re.I) and "examination date" not in d["SQL"].lower()
            c["Laboratory.Date" if uses_lab else ("Examination Date" if "examination date" in d["SQL"].lower() else "other")] += 1
        print("  'exam' + date questions -> date column used:", dict(c))
        pats = [d for d in items if re.search(r"how many patients", d["question"], re.I)]
        dp = sum(1 for d in pats if re.search(r"COUNT\s*\(\s*DISTINCT", d["SQL"], re.I))
        print(f"  'how many patients': {len(pats)}, DISTINCT {dp}")
