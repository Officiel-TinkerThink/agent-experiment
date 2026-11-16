// Run one agent variant over a question set and score it.
// Usage: node agent/run.mjs <variant> <set> [--n N] [--conc 3] [--tag name]
// The agent only ever sees the question text: BIRD evidence/hints are never put in the prompt.
//   set: train-dev (learned layer from learn fold) | train-learn | test (learned layer from all train)
// For set=test only aggregate metrics are printed; per-question rows go to data/sealed/results/.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { strippedQuery } from "../../strip_wrap.mjs";
import { Context } from "./context.mjs";
import { makeQuestionTools, runSql, formatResult } from "./tools.mjs";
import { VARIANTS } from "./variants.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const MODEL = "claude-haiku-5-5";
const args = process.argv.slice(2);
const variantName = args[0];
const set = args[1];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const N = Number(opt("n", "0"));
const CONC = Number(opt("conc", "3"));
const TAG = opt("tag", variantName);
const variant = VARIANTS[variantName];
const REVIEWER = `You review one SQLite answer to a data question. Check only these, in order:
1. Output contract: do the result columns match exactly what the question asks for (no missing requested value, no extra unrequested columns)?
2. Grain: is it the right level (one row vs list, counts of the right entity, no duplicates the question would not want)?
3. Logic: filters, thresholds, joins and aggregation match the question; follow the closest past question's conventions when it has the same shape.
Reply with exactly "OK" if it is correct, or "FIX: <one or two sentences naming the specific problem>". Do not rewrite the SQL. Be conservative: reply OK unless you see a concrete problem.`;
if (!variant) throw new Error(`unknown variant ${variantName}`);

// ---- question set ----
let questions, gold, fold, outDir;
if (set === "test") {
  questions = JSON.parse(readFileSync(join(ROOT, "data/sealed/test.json"), "utf8"));
  gold = JSON.parse(readFileSync(join(ROOT, "data/sealed/test_gold.json"), "utf8"));
  fold = "all";
  outDir = join(ROOT, "data/sealed/results");
} else {
  const train = JSON.parse(readFileSync(join(ROOT, "data/split/train.json"), "utf8"));
  const folds = JSON.parse(readFileSync(join(ROOT, "data/split/train_folds.json"), "utf8"));
  gold = JSON.parse(readFileSync(join(ROOT, "data/split/train_gold.json"), "utf8"));
  outDir = join(ROOT, "data/runs");
  if (set === "train-cv") {
    // Leave-group-out over all train: learned layer from all train minus the question's own group.
    questions = train;
    fold = "all";
  } else {
    const ids = new Set(set === "train-dev" ? folds.dev : folds.learn);
    questions = train.filter((d) => ids.has(d.question_id));
    fold = "learn";
  }
}
const groups = set === "train-cv" ? JSON.parse(readFileSync(join(ROOT, "data/split/train_groups.json"), "utf8")) : null;
const groupMembers = new Map();
if (groups) for (const [qid, g] of Object.entries(groups)) {
  if (!groupMembers.has(g)) groupMembers.set(g, new Set());
  groupMembers.get(g).add(Number(qid));
}
if (N > 0) questions = questions.slice(0, N);
mkdirSync(outDir, { recursive: true });
mkdirSync(join(ROOT, "data/runs"), { recursive: true });
const outFile = join(outDir, `${TAG}.${set}.jsonl`);
writeFileSync(outFile, "");

const contexts = new Map();
function ctxFor(item) {
  const db = item.db_id;
  if (groups && variant.learned) {
    return new Context(db, fold, { exclude: groupMembers.get(groups[String(item.question_id)]) });
  }
  const key = db + (variant.learned ? fold : "");
  if (!contexts.has(key)) contexts.set(key, new Context(db, variant.learned ? fold : null));
  return contexts.get(key);
}

function rowKey(row) {
  return JSON.stringify(row.map((v) => (typeof v === "number" && Number.isInteger(v) ? v : v)));
}
function sameResult(a, b) {
  const A = new Set(a.map(rowKey)), B = new Set(b.map(rowKey));
  if (A.size !== B.size) return false;
  for (const k of A) if (!B.has(k)) return false;
  return true;
}

function goldRefs(sql, ctx) {
  const toks = new Set([...sql.matchAll(/`([^`]+)`|"([^"]+)"|([A-Za-z_][A-Za-z0-9_\-]*)/g)].map((m) => (m[1] ?? m[2] ?? m[3]).toLowerCase()));
  const tablesIn = ctx.base.tables.filter((t) => toks.has(t.name.toLowerCase())).map((t) => t.name.toLowerCase());
  return ctx.base.columns.filter((c) => toks.has(c.name.toLowerCase()) && (!tablesIn.length || tablesIn.includes(c.table.toLowerCase())));
}

const traceDir = join(set === "test" ? join(ROOT, "data/sealed/traces") : join(ROOT, "data/traces"), TAG);
mkdirSync(traceDir, { recursive: true });

function clip(s, n = 2500) {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.length > n ? t.slice(0, n) + `…(+${t.length - n})` : t;
}

// One compact event per SDK message: what the model said and called, what tools returned.
function traceEvent(msg, ms) {
  if (msg.type === "assistant") {
    const u = msg.message?.usage ?? {};
    return {
      ms, role: "assistant",
      usage: { in: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, out: u.output_tokens },
      blocks: (msg.message?.content ?? []).map((b) =>
        b.type === "text" ? { text: clip(b.text) }
          : b.type === "tool_use" ? { tool: b.name, input: b.input?.code ?? b.input?.sql ?? b.input }
            : b.type === "thinking" ? { thinking: clip(b.thinking, 1500) } : { type: b.type }),
    };
  }
  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return null;
    return {
      ms, role: "tool",
      blocks: content.filter((b) => b.type === "tool_result").map((b) => ({
        result: clip(Array.isArray(b.content) ? b.content.map((c) => c.text ?? "").join("\n") : b.content),
      })),
    };
  }
  if (msg.type === "result") return { ms, role: "result", subtype: msg.subtype, turns: msg.num_turns, is_error: msg.is_error };
  return null;
}

async function runOne(item) {
  const ctx = ctxFor(item);
  if (ctx.examples.some((x) => x.qid === item.question_id)) throw new Error(`leak: question ${item.question_id} sees its own example`);
  const q = item.question;
  const state = { exploreCalls: 0, sqlCalls: 0, submits: 0, finalSql: null, finalOk: false, seen: [] };
  const system = variant.system(ctx);
  const prompt = variant.prompt(q, ctx);
  const t0 = Date.now();
  let result = null;
  let attempt = 0;
  let trace = [];
  while (attempt < 3) {
    attempt += 1;
    const server = makeQuestionTools(ctx, state);
    result = null;
    trace = [];
    try {
      for await (const msg of await strippedQuery({
        prompt,
        options: {
          systemPrompt: system,
          model: MODEL,
          tools: [],
          mcpServers: { db: server },
          allowedTools: ["mcp__db__explore", "mcp__db__submit_sql"],
          maxTurns: variant.maxTurns ?? 14,
          settingSources: [],
          persistSession: false,
          strictMcpConfig: true,
          title: "q",
        },
      })) {
        const ev = traceEvent(msg, Date.now() - t0);
        if (ev) trace.push(ev);
        if (msg.type === "result") result = msg;
      }
    } catch (e) {
      result = { is_error: true, result: String(e?.message ?? e) };
    }
    const rateLimited = result?.is_error && /rate|limit|overloaded|429|529/i.test(String(result?.result ?? ""));
    if (!rateLimited || state.finalSql) break;
    await new Promise((r) => setTimeout(r, 20000 * attempt));
  }
  const usages = [result?.modelUsage ?? {}];
  let review = null;
  if (variant.review && state.finalSql) {
    // One-off reviewer: no tools, sees only the question, the SQL, a result preview and the
    // closest past question. On FIX, a fresh agent gets one retry with the reviewer's note.
    const preview = await runSql(item.db_id, state.finalSql, 5);
    const nearest = ctx.similar(q, ctx.link(q, { k: 10 }).map((c) => c.id), 1).map((id) => ctx.get(id))[0];
    const reviewPrompt = `QUESTION: ${q}\n\nSUBMITTED SQL:\n${state.finalSql}\n\nRESULT PREVIEW:\n${formatResult(preview, 5)}` +
      (nearest ? `\n\nCLOSEST PAST QUESTION (verified):\nQ: ${nearest.question}\nSQL: ${nearest.sql.replace(/\s+/g, " ")}` : "");
    let reviewText = "", reviewUsage = {};
    for await (const msg of await strippedQuery({
      prompt: reviewPrompt,
      options: { systemPrompt: REVIEWER, model: MODEL, tools: [], maxTurns: 1, settingSources: [], persistSession: false, strictMcpConfig: true, title: "r" },
    })) {
      if (msg.type === "result") { reviewText = String(msg.result ?? ""); reviewUsage = msg.modelUsage ?? {}; }
    }
    usages.push(reviewUsage);
    review = { verdict: /^\s*FIX/i.test(reviewText) ? "FIX" : "OK", note: reviewText.slice(0, 400) };
    trace.push({ ms: Date.now() - t0, role: "reviewer", ...review });
    if (review.verdict === "FIX") {
      const first = state.finalSql;
      const retryState = { exploreCalls: 0, sqlCalls: 0, submits: 0, finalSql: null, finalOk: false, seen: [] };
      const retryPrompt = `${prompt}\n\nA PREVIOUS ATTEMPT submitted:\n${first}\nResult preview:\n${formatResult(preview, 5)}\nReviewer note: ${review.note}\nSubmit the corrected query, or resubmit the same query if the note is wrong.`;
      for await (const msg of await strippedQuery({
        prompt: retryPrompt,
        options: { systemPrompt: system, model: MODEL, tools: [], mcpServers: { db: makeQuestionTools(ctx, retryState) },
          allowedTools: ["mcp__db__explore", "mcp__db__submit_sql"], maxTurns: 10, settingSources: [], persistSession: false, strictMcpConfig: true, title: "q" },
      })) {
        const ev = traceEvent(msg, Date.now() - t0);
        if (ev) trace.push({ ...ev, retry: true });
        if (msg.type === "result") usages.push(msg.modelUsage ?? {});
      }
      if (retryState.finalSql) state.finalSql = retryState.finalSql;
      state.exploreCalls += retryState.exploreCalls;
      state.seen.push(...retryState.seen);
      review.changed = state.finalSql !== first;
    }
  }
  const ms = Date.now() - t0;

  let correct = false, execError = null;
  const g = gold[String(item.question_id)];
  if (state.finalSql) {
    const r = await runSql(item.db_id, state.finalSql, null, 60);
    if (r.ok) correct = sameResult(r.rows, g.rows);
    else execError = r.error;
  }
  const models = [...new Set(usages.flatMap((u) => Object.keys(u)))];
  let inTok = 0, outTok = 0, cacheRead = 0, cacheWrite = 0;
  for (const u of usages.flatMap((x) => Object.values(x))) {
    inTok += u.inputTokens ?? 0; outTok += u.outputTokens ?? 0;
    cacheRead += u.cacheReadInputTokens ?? 0; cacheWrite += u.cacheCreationInputTokens ?? 0;
  }
  // Schema recall: a gold column counts as seen only when shown qualified by its table
  // ("table.col"), or listed inside a block for its table (schema dump / table() output).
  const shown = (text, c) => {
    const t = text.toLowerCase(), tn = c.table.toLowerCase(), cn = c.name.toLowerCase();
    if (t.includes(`${tn}.${cn}`)) return true;
    const blockStart = Math.max(t.indexOf(`table ${tn} (`), t.indexOf(`"table":"${tn}"`));
    if (blockStart < 0) return false;
    const block = t.slice(blockStart, blockStart + 6000);
    return new RegExp(`(^|[\\s"'(])${cn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s"',)]|$)`, "m").test(block);
  };
  const seenText = system + "\n" + prompt + "\n" + state.seen.join("\n");
  const refs = goldRefs(item.SQL, ctx);
  const recalled = refs.filter((c) => shown(seenText, c));
  const promptRecalled = refs.filter((c) => shown(system + "\n" + prompt, c));
  writeFileSync(join(traceDir, `${item.question_id}.json`), JSON.stringify({
    qid: item.question_id, db: item.db_id, question: item.question, correct, finalSql: state.finalSql, execError,
    goldSql: item.SQL, goldPreview: g.rows.slice(0, 5), goldRows: g.rows.length,
    missingCols: refs.filter((c) => !recalled.includes(c)).map((c) => c.id),
    prompt, trace,
  }, null, 1));
  return {
    qid: item.question_id, db: item.db_id, difficulty: item.difficulty, correct,
    submitted: Boolean(state.finalSql), execError, sql: state.finalSql,
    turns: result?.num_turns ?? null, explore: state.exploreCalls, sqlCalls: state.sqlCalls, submits: state.submits,
    inTok, outTok, cacheRead, cacheWrite, totalIn: inTok + cacheRead + cacheWrite,
    ms, models, nonHaiku: models.some((m) => !m.includes("haiku")), error: result?.is_error ? String(result.result).slice(0, 200) : null,
    review: review?.verdict ?? null, reviewChanged: review?.changed ?? false,
    goldCols: refs.length, recalledCols: recalled.length, promptRecalledCols: promptRecalled.length,
    promptChars: system.length + prompt.length,
  };
}

const rows = [];
let next = 0;
async function worker() {
  while (next < questions.length) {
    const item = questions[next++];
    const row = await runOne(item);
    rows.push(row);
    appendFileSync(outFile, JSON.stringify(row) + "\n");
    if (set !== "test") process.stdout.write(row.correct ? "+" : row.submitted ? "-" : "x");
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
process.stdout.write("\n");

const n = rows.length;
const sum = (f) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
const byDb = {};
for (const r of rows) {
  byDb[r.db] ??= [0, 0];
  byDb[r.db][0] += r.correct; byDb[r.db][1] += 1;
}
const byDiff = {};
for (const r of rows) {
  byDiff[r.difficulty] ??= [0, 0];
  byDiff[r.difficulty][0] += r.correct; byDiff[r.difficulty][1] += 1;
}
const summary = {
  tag: TAG, set, n, accuracy: +(sum((r) => r.correct) / n * 100).toFixed(1),
  submitted: sum((r) => r.submitted), execErrors: sum((r) => (r.execError ? 1 : 0)), agentErrors: sum((r) => (r.error ? 1 : 0)),
  byDb: Object.fromEntries(Object.entries(byDb).map(([k, [c, t]]) => [k, `${c}/${t}`])),
  byDifficulty: Object.fromEntries(Object.entries(byDiff).map(([k, [c, t]]) => [k, `${c}/${t}`])),
  schemaRecall: +(sum((r) => r.recalledCols) / Math.max(1, sum((r) => r.goldCols)) * 100).toFixed(1),
  promptSchemaRecall: +(sum((r) => r.promptRecalledCols ?? 0) / Math.max(1, sum((r) => r.goldCols)) * 100).toFixed(1),
  avgTotalInputTokens: Math.round(sum((r) => r.totalIn) / n), avgOutputTokens: Math.round(sum((r) => r.outTok) / n),
  avgTurns: +(sum((r) => r.turns) / n).toFixed(1), avgExplore: +(sum((r) => r.explore) / n).toFixed(1),
  avgSeconds: +(sum((r) => r.ms) / n / 1000).toFixed(1), nonHaikuCalls: sum((r) => (r.nonHaiku ? 1 : 0)),
  models: [...new Set(rows.flatMap((r) => r.models))],
};
console.log(JSON.stringify(summary, null, 1));
appendFileSync(join(ROOT, "data/runs/summary.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...summary }) + "\n");
