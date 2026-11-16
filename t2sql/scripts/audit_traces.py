"""Audit agent code in traces for sandbox escapes or dataset access. Prints counts only.

Usage: python3 -I scripts/audit_traces.py <traces_root>   (e.g. data/traces or data/sealed/traces)
Only the agent's own tool inputs are scanned; question text and results are not printed.
"""
import json
import re
import sys
from pathlib import Path

PATTERN = re.compile(r"require\(|process\.|import\(|\.constructor|readFileSync|globalThis|dev\.json|sealed|test_gold|train_gold|/home/", re.I)
root = Path(sys.argv[1])
files = calls = hits = 0
hit_tags = {}
for f in root.rglob("*.json"):
    files += 1
    t = json.loads(f.read_text())
    for e in t.get("trace", []):
        for b in e.get("blocks", []):
            if "tool" in b:
                calls += 1
                if PATTERN.search(json.dumps(b.get("input", ""))):
                    hits += 1
                    hit_tags[f.parent.name] = hit_tags.get(f.parent.name, 0) + 1
print(f"trace files {files}, tool calls {calls}, suspicious tool inputs {hits}, by run {hit_tags}")
