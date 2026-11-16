"""Build the base context graph for each database (schema layer, no learning).

Sources: the SQLite database itself, BIRD's dev_tables.json (keys), and the database's own
database_description/*.csv files. No question data is used here.
Output: data/graph/<db>.base.json  {tables, columns, edges, values}
"""
import csv
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "data/db"
TABLES_JSON = ROOT / "data/download/dev_20240627/dev_tables.json"
OUT = ROOT / "data/graph"
DBS = ["card_games", "toxicology", "thrombosis_prediction"]
VALUE_MAX_DISTINCT = 60000
VALUE_MAX_LEN = 120
TOP_VALUES = 6
# Identifiers, hashes and links: never named in a question, so not worth indexing as values.
ID_LIKE = re.compile(r"[0-9a-f]{8}-[0-9a-f\-]{20,}|https?://\S+|[0-9a-f]{24,}|\d+(\.\d+)?", re.I)


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def read_descriptions(db: str) -> dict:
    out = {}
    for f in (DB_DIR / db / "database_description").glob("*.csv"):
        raw = f.read_bytes()
        for enc in ("utf-8-sig", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        rows = list(csv.DictReader(text.splitlines(keepends=True)))
        for r in rows:
            col = (r.get("original_column_name") or "").strip()
            if not col:
                continue
            out[(f.stem.lower(), col.lower())] = {
                "label": (r.get("column_name") or "").strip(),
                "description": re.sub(r"\s+", " ", (r.get("column_description") or "")).strip(),
                "value_description": re.sub(r"[ \t]+", " ", (r.get("value_description") or "")).strip(),
            }
    return out


def date_pattern(samples):
    pats = set()
    for s in samples:
        if not isinstance(s, str):
            return None
        p = re.sub(r"\d", "9", s)
        pats.add(p)
    if pats and all(re.fullmatch(r"[9\-/: T\.]+", p) for p in pats):
        return sorted(pats)[:3]
    return None


def profile(conn, table, col, ctype, n_rows):
    t, c = q(table), q(col)
    distinct, nulls = conn.execute(
        f"SELECT COUNT(DISTINCT {c}), SUM({c} IS NULL) FROM {t}").fetchone()
    top = conn.execute(
        f"SELECT {c}, COUNT(*) n FROM {t} WHERE {c} IS NOT NULL GROUP BY {c} "
        f"ORDER BY n DESC LIMIT {TOP_VALUES}").fetchall()
    info = {"distinct": distinct, "null_frac": round((nulls or 0) / n_rows, 3) if n_rows else 0,
            "top": [[v if not isinstance(v, str) else v[:60], n] for v, n in top]}
    storage = conn.execute(
        f"SELECT typeof({c}), COUNT(*) FROM {t} WHERE {c} IS NOT NULL GROUP BY 1").fetchall()
    info["storage"] = {k: v for k, v in storage}
    if any(k in ("integer", "real") for k in info["storage"]):
        mn, mx = conn.execute(
            f"SELECT MIN({c}), MAX({c}) FROM {t} WHERE typeof({c}) IN ('integer','real')").fetchone()
        info["min"], info["max"] = mn, mx
    if "text" in info["storage"]:
        dp = date_pattern([v for v, _ in top])
        if dp:
            mn, mx = conn.execute(f"SELECT MIN({c}), MAX({c}) FROM {t} WHERE {c} IS NOT NULL").fetchone()
            info["date_format"], info["min"], info["max"] = dp, mn, mx
    return info


def build(db, tables_meta):
    conn = sqlite3.connect(f"file:{DB_DIR / db / (db + '.sqlite')}?mode=ro", uri=True)
    conn.text_factory = lambda b: b.decode("utf-8", "replace")
    desc = read_descriptions(db)
    meta = tables_meta[db]
    tnames = meta["table_names_original"]
    cols_meta = meta["column_names_original"]
    graph = {"db": db, "tables": [], "columns": [], "edges": [], "values": {}}
    for ti, tname in enumerate(tnames):
        n_rows = conn.execute(f"SELECT COUNT(*) FROM {q(tname)}").fetchone()[0]
        pk = [cols_meta[i][1] for i in (meta["primary_keys"] if isinstance(meta["primary_keys"], list) else [])
              for i in ([i] if isinstance(i, int) else i) if cols_meta[i][0] == ti]
        col_names = [c for (t, c) in cols_meta if t == ti]
        graph["tables"].append({"id": f"t:{tname}", "name": tname, "rows": n_rows,
                                "columns": col_names, "primary_key": pk})
        types = {r[1]: r[2] for r in conn.execute(f"PRAGMA table_info({q(tname)})")}
        for cname in col_names:
            d = desc.get((tname.lower(), cname.lower()), {})
            info = profile(conn, tname, cname, types.get(cname, ""), n_rows)
            node = {"id": f"c:{tname}.{cname}", "table": tname, "name": cname,
                    "type": types.get(cname, ""), **d, **info}
            graph["columns"].append(node)
            if "text" in info["storage"] and 0 < info["distinct"] <= VALUE_MAX_DISTINCT:
                vals = [r[0] for r in conn.execute(
                    f"SELECT DISTINCT {q(cname)} FROM {q(tname)} WHERE typeof({q(cname)})='text' "
                    f"AND length({q(cname)}) <= {VALUE_MAX_LEN}")]
                vals = [v for v in vals if not ID_LIKE.fullmatch(v)]
                if vals and len(vals) >= 0.5 * info["distinct"]:
                    graph["values"][f"{tname}.{cname}"] = vals
    for a, b in meta["foreign_keys"]:
        ta, ca = cols_meta[a]
        tb, cb = cols_meta[b]
        graph["edges"].append({"type": "fk", "from": f"c:{tnames[ta]}.{ca}", "to": f"c:{tnames[tb]}.{cb}"})
    conn.close()
    return graph


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tables_meta = {m["db_id"]: m for m in json.load(open(TABLES_JSON))}
    for db in DBS:
        g = build(db, tables_meta)
        path = OUT / f"{db}.base.json"
        json.dump(g, open(path, "w"))
        n_vals = sum(len(v) for v in g["values"].values())
        print(f"{db}: {len(g['tables'])} tables, {len(g['columns'])} columns, {len(g['edges'])} fk edges, "
              f"{len(g['values'])} value columns, {n_vals} values, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
