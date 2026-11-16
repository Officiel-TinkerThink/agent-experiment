"""Print the last N run summaries from data/runs/summary.jsonl as compact lines."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
lines = (ROOT / "data/runs/summary.jsonl").read_text().splitlines()[-n:]
for line in lines:
    o = json.loads(line)
    print(f"{o['tag']:<22} {o['set']:<10} n={o['n']:<3} EX={o['accuracy']:>5}%  db={o['byDb']}  diff={o['byDifficulty']}")
    print(f"{'':<22} recall={o['schemaRecall']}% promptRecall={o.get('promptSchemaRecall')}% in={o['avgTotalInputTokens']} "
          f"out={o['avgOutputTokens']} turns={o['avgTurns']} explore={o['avgExplore']} s={o['avgSeconds']} "
          f"submitted={o['submitted']} agentErr={o['agentErrors']} nonHaiku={o['nonHaikuCalls']} models={o['models']}")
