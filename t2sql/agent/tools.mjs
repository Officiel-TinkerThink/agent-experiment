// Per-question tools for the analytics agent: code-mode exploration and final submission.
// The agent never gets filesystem or shell access; only these tools.
import { spawn } from "node:child_process";
import vm from "node:vm";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

const ROOT = new URL("..", import.meta.url).pathname;
const MAX_OUT = 3500;

export function runSql(db, sql, maxRows = 50, timeoutS = 30) {
  return new Promise((resolve) => {
    const p = spawn("python3", ["-I", `${ROOT}lib/sqlrun.py`], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, error: "runner failed" }); }
    });
    p.stdin.end(JSON.stringify({ db, sql, max_rows: maxRows, timeout_s: timeoutS }));
  });
}

export function formatResult(r, maxRows = 15) {
  if (!r.ok) return `ERROR: ${r.error}`;
  const cell = (v) => {
    const s = v === null ? "NULL" : String(v);
    return s.length > 60 ? s.slice(0, 60) + "…" : s;
  };
  const lines = [r.columns.join(" | ")];
  for (const row of r.rows.slice(0, maxRows)) lines.push(row.map(cell).join(" | "));
  lines.push(`(${r.n_rows} row${r.n_rows === 1 ? "" : "s"}${r.n_rows > maxRows ? `, first ${maxRows} shown` : ""})`);
  return lines.join("\n");
}

export const EXPLORE_DOC = `Run JavaScript to explore the database context. Only what you print() is returned.
Functions (all synchronous except sql):
  search(q, {kind?, k?})  keyword search; kind: "column" | "concept" | "example" | "table" (default: column+concept+example)
  get(id)                 full node: "c:table.col" (type, description, value codes, distinct, top values, min/max, date format, joins) | "k:N" concept | "x:N" past question with its SQL
  table(name)             columns, row count, primary key, joins of a table
  joins(tableA, tableB)   join path (list of "a.x = b.y")
  link(q, {k?})           columns ranked by keyword match + links learned from past questions
  neighbors(id, {rel?})   graph links of a node: column -> in_table, joins, concept, used_by (past questions); table -> has_column
  expand([ids])           closure from seed column ids: join paths connecting them, concepts about them, past questions using them
  values(text, {column?, k?})  find stored values matching words in text (entity linking), with their column
  await sql(query, maxRows=15)  run read-only SQLite, returns a printable table string
  print(...args)          objects are printed as compact JSON
Batch several lookups in one call. Example:
  print(search("mana cost", {kind:"column"})); print(values("Ancestor's Chosen")); print(await sql("SELECT COUNT(*) FROM cards"))`;

export function makeQuestionTools(ctx, state) {
  const explore = tool(
    "explore",
    EXPLORE_DOC,
    { code: z.string().describe("JavaScript to run; may use await") },
    async ({ code }) => {
      state.exploreCalls += 1;
      const outLines = [];
      const print = (...args) => {
        outLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      };
      const sandbox = {
        print, JSON, Math, Array, Object, String, Number, Set, Map,
        search: (q, o) => ctx.search(q, o),
        get: (id) => ctx.get(id),
        table: (n) => ctx.table(n),
        joins: (a, b) => ctx.joins(a, b),
        values: (q, o) => ctx.values(q, o),
        link: (q, o) => ctx.link(q, o),
        neighbors: (id, o) => ctx.neighbors(id, o),
        expand: (ids, o) => ctx.expand(Array.isArray(ids) ? ids : [ids], o),
        sql: async (q, n = 15) => {
          state.sqlCalls += 1;
          return formatResult(await runSql(ctx.db, q, Math.min(n, 50)), Math.min(n, 50));
        },
      };
      let text;
      try {
        const script = new vm.Script(`(async () => {\n${code}\n})()`);
        const p = script.runInNewContext(sandbox, { timeout: 5000 });
        await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("explore timed out after 60s")), 60000))]);
        text = outLines.join("\n") || "(nothing printed; use print())";
      } catch (e) {
        text = (outLines.join("\n") + `\nERROR: ${e?.message ?? e}`).trim();
      }
      if (text.length > MAX_OUT) text = text.slice(0, MAX_OUT) + `\n…(truncated ${text.length - MAX_OUT} chars; print less)`;
      state.seen.push(text);
      return { content: [{ type: "text", text }] };
    },
    { alwaysLoad: true },
  );

  const submit = tool(
    "submit_sql",
    "Submit the final SQLite query that answers the question. It is executed and the first rows are shown. You may submit again to replace it; the last submission counts.",
    { sql: z.string() },
    async ({ sql }) => {
      state.submits += 1;
      state.finalSql = sql;
      const r = await runSql(ctx.db, sql, 10);
      state.finalOk = r.ok;
      return { content: [{ type: "text", text: r.ok ? `Submitted. Result preview:\n${formatResult(r, 10)}` : `Submitted, but it fails: ${r.error}. Fix and submit again.` }] };
    },
    { alwaysLoad: true },
  );

  return createSdkMcpServer({ name: "db", version: "1.0.0", tools: [explore, submit] });
}
