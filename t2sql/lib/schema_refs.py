"""Find which schema columns a piece of SQL or text refers to (for linking and recall metrics)."""
import re


def refs_in(text: str, base: dict) -> list:
    """Return sorted column ids (c:table.col) whose column name appears as an identifier in text."""
    if not text:
        return []
    tokens = set()
    for m in re.finditer(r"`([^`]+)`|\"([^\"]+)\"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_\-]*)", text):
        tok = next(g for g in m.groups() if g is not None)
        tokens.add(tok.lower())
    tables_in = {t["name"].lower() for t in base["tables"] if t["name"].lower() in tokens}
    out = set()
    for c in base["columns"]:
        if c["name"].lower() in tokens:
            # Prefer columns of tables that the text also names; keep all if no table is named.
            if not tables_in or c["table"].lower() in tables_in:
                out.add(c["id"])
    return sorted(out)


def tables_of(refs: list) -> list:
    return sorted({r[2:].split(".", 1)[0] for r in refs})
