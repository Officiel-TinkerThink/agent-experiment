// Offline retrieval metrics (no model calls) on TRAIN folds.
// Usage: node agent/retrieval_eval.mjs [train-dev|train-learn]
// Column recall: share of gold-SQL columns shown table-qualified in the pack.
// Full-recall rate: share of questions where every gold column is in the pack.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Context } from "./context.mjs";
import { closurePack, closurePack3 } from "./variants.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const set = process.argv[2] ?? "train-dev";
const train = JSON.parse(readFileSync(join(ROOT, "data/split/train.json"), "utf8"));
const folds = JSON.parse(readFileSync(join(ROOT, "data/split/train_folds.json"), "utf8"));
const cv = set === "train-cv";
const ids = new Set(set === "train-dev" ? folds.dev : folds.learn);
const qs = cv ? train : train.filter((d) => ids.has(d.question_id));
const groups = cv ? JSON.parse(readFileSync(join(ROOT, "data/split/train_groups.json"), "utf8")) : null;
const members = new Map();
if (groups) for (const [q, g] of Object.entries(groups)) { if (!members.has(g)) members.set(g, new Set()); members.get(g).add(Number(q)); }
const ctxs = {};
const ctxOf = (d) => cv ? new Context(d.db_id, "all", { exclude: members.get(groups[String(d.question_id)]) }) : (ctxs[d.db_id] ??= new Context(d.db_id, "learn"));

function goldCols(sql, ctx) {
  const toks = new Set([...sql.matchAll(/`([^`]+)`|"([^"]+)"|([A-Za-z_][A-Za-z0-9_\-]*)/g)].map((m) => (m[1] ?? m[2] ?? m[3]).toLowerCase()));
  const tablesIn = ctx.base.tables.filter((t) => toks.has(t.name.toLowerCase())).map((t) => t.name.toLowerCase());
  return ctx.base.columns.filter((c) => toks.has(c.name.toLowerCase()) && (!tablesIn.length || tablesIn.includes(c.table.toLowerCase())));
}

const packs = {
  v1_search: (q, ctx) => closurePack(q, ctx),
  v3_linked: (q, ctx) => closurePack3(q, ctx),
  v3_linked_k15: (q, ctx) => closurePack3(q, ctx, { cols: 15 }),
};
for (const [name, fn] of Object.entries(packs)) {
  let hit = 0, total = 0, full = 0, chars = 0;
  for (const d of qs) {
    const ctx = ctxOf(d);
    if (ctx.examples.some((x) => x.qid === d.question_id)) throw new Error("leak");
    const pack = fn(d.question, ctx).toLowerCase();
    const g = goldCols(d.SQL, ctx);
    const h = g.filter((c) => pack.includes(`${c.table.toLowerCase()}.${c.name.toLowerCase()}`)).length;
    hit += h; total += g.length; full += h === g.length; chars += pack.length;
  }
  console.log(`${name.padEnd(16)} column recall ${(hit / total * 100).toFixed(1)}%  full-recall questions ${(full / qs.length * 100).toFixed(1)}%  avg pack ${Math.round(chars / qs.length)} chars (~${Math.round(chars / qs.length / 3.6)} tokens)`);
}
