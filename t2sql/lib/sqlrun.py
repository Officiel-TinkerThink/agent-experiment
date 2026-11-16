"""Read-only SQL runner with a timeout. Reads one JSON request on stdin, writes JSON on stdout.

Request: {"db": "<db_id>", "sql": "...", "max_rows": 50 | null, "timeout_s": 30}
Reply:   {"ok": true, "columns": [...], "rows": [[...]], "n_rows": N, "truncated": bool}
      or {"ok": false, "error": "..."}
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent / "data/db"


def run(req: dict) -> dict:
    db = req["db"]
    path = DB_DIR / db / f"{db}.sqlite"
    if not path.exists() or "/" in db:
        return {"ok": False, "error": f"unknown database {db!r}"}
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    deadline = time.monotonic() + float(req.get("timeout_s", 30))
    conn.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 10000)
    conn.text_factory = lambda b: b.decode("utf-8", "replace")
    conn.execute("PRAGMA query_only = ON")
    denied = {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH}
    conn.set_authorizer(lambda action, *_: sqlite3.SQLITE_DENY if action in denied else sqlite3.SQLITE_OK)
    try:
        cur = conn.execute(req["sql"])
        cols = [d[0] for d in cur.description] if cur.description else []
        max_rows = req.get("max_rows")
        if max_rows is None:
            rows = cur.fetchall()
            truncated = False
            n_rows = len(rows)
        else:
            rows = cur.fetchmany(max_rows + 1)
            truncated = len(rows) > max_rows
            rows = rows[:max_rows]
            n_rows = len(rows) + sum(1 for _ in cur) if truncated else len(rows)
            if truncated:
                n_rows += 1
        return {"ok": True, "columns": cols, "rows": [list(r) for r in rows],
                "n_rows": n_rows, "truncated": truncated}
    except sqlite3.OperationalError as e:
        msg = str(e)
        if msg == "interrupted":
            msg = f"query timed out after {req.get('timeout_s', 30)}s"
        return {"ok": False, "error": msg}
    except Exception as e:  # noqa: BLE001 - every SQL error is reported back to the caller
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    finally:
        conn.close()


if __name__ == "__main__":
    req = json.loads(sys.stdin.read())
    sys.stdout.write(json.dumps(run(req), default=str))
