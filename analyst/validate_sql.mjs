// Read-only SQL checker for the sample sales database.
// Usage: node analyst/validate_sql.mjs <path-to-.sql-file | "SELECT ...">
// Accepts one SELECT or WITH statement and prints JSON: {ok, rowCount, rows} or {ok:false, error}.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2] ?? "";
const raw = existsSync(arg) ? readFileSync(arg, "utf8") : arg;
const sql = raw.replace(/--[^\n]*/g, "").trim().replace(/;\s*$/, "");
const out = (o) => console.log(JSON.stringify(o));

if (!/^(with|select)\b/i.test(sql) || sql.includes(";")) {
  out({ ok: false, error: "Only one SELECT or WITH statement is allowed." });
} else {
  const db = new DatabaseSync(join(here, "db", "sales.sqlite"), { readOnly: true });
  try {
    const rows = db.prepare(sql).all();
    out({ ok: true, rowCount: rows.length, rows: rows.slice(0, 50) });
  } catch (e) {
    out({ ok: false, error: e.message });
  }
}
