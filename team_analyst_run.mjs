// Two-team data-analyst experiment.
// Team SEMANTIC (sem-lead + sem-schema, sem-metadata, sem-joins, sem-checker) inspects the DB and semantic layer.
// Team BUSINESS (biz-lead + biz-glossary, biz-context, biz-metrics, biz-sqlwriter) turns the question into SQL.
// Only the two leads message each other across teams. Members message their own team and their lead.
// Usage: node team_analyst_run.mjs q1      (or q2)
// Runs on the Claude Code login; API key variables are removed.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const root = dirname(fileURLToPath(import.meta.url));
const analyst = join(root, "analyst");
const qid = process.argv[2];
if (!qid) {
  console.error("usage: node team_analyst_run.mjs q1|q2");
  process.exit(1);
}
const question = readFileSync(join(analyst, "questions", `${qid}.md`), "utf8").trim();
const runDir = join(analyst, "runs", qid);
mkdirSync(runDir, { recursive: true });
const finalSql = join(runDir, "final.sql");

const SEM_MEMBERS = ["sem-schema", "sem-metadata", "sem-joins", "sem-checker"];
const BIZ_MEMBERS = ["biz-glossary", "biz-context", "biz-metrics", "biz-sqlwriter"];

const agents = {
  "sem-lead": {
    description: "Leads the SEMANTIC team. Talks to biz-lead.",
    prompt:
      `You lead the SEMANTIC team with members ${SEM_MEMBERS.join(", ")}. ` +
      "Spawn each member once with the Agent tool: name and subagent_type set to the member's name, run_in_background true. " +
      "Give each one concrete sub-task about the question you are given. " +
      "Members may message you and each other with SendMessage. They never message biz-lead; you are the only one who does. " +
      "When biz-lead sends you a question or a SQL candidate, forward it to the right member, collect the answer, and reply to biz-lead with SendMessage (to 'biz-lead'). " +
      "Send sem-checker any SQL candidate to validate. Do not write SQL yourself. Keep messages short.",
    tools: ["Agent", "SendMessage", "Read"],
  },
  "biz-lead": {
    description: "Leads the BUSINESS team. Talks to sem-lead and owns the final SQL.",
    prompt:
      `You lead the BUSINESS team with members ${BIZ_MEMBERS.join(", ")}. ` +
      "Spawn each member once with the Agent tool: name and subagent_type set to the member's name, run_in_background true. " +
      "Give each one a concrete sub-task about the question you are given. " +
      "Members may message you and each other with SendMessage. They never message sem-lead; you are the only one who does. " +
      "Ask sem-lead (SendMessage to 'sem-lead') for table and join facts and for SQL validation. " +
      `Your final SQL must be saved by biz-sqlwriter to ${finalSql}. Then ask sem-lead to validate it and fix it if it fails. ` +
      "Report to the coordinator when the validated SQL is final.",
    tools: ["Agent", "SendMessage", "Read"],
  },
  "sem-schema": {
    description: "Inspects the database schema.",
    prompt:
      `Run: node ${analyst}/validate_sql.mjs "SELECT name, sql FROM sqlite_master WHERE type='table'" ` +
      `and read ${analyst}/semantic/metadata.json. Report the tables, keys, and any mismatch between the database and the metadata, in under 150 words. ` +
      "Send the report to sem-lead with SendMessage.",
    tools: ["Read", "Bash", "SendMessage"],
  },
  "sem-metadata": {
    description: "Explains metadata fields a query writer needs.",
    prompt:
      `Read ${analyst}/semantic/metadata.json and ${analyst}/business/glossary.md. For the question you are given, list the table, column, meaning, and caveat for each field a query needs, in under 150 words. ` +
      "Send it to sem-lead with SendMessage.",
    tools: ["Read", "SendMessage"],
  },
  "sem-joins": {
    description: "Maps join paths and grain, and warns about fan-out.",
    prompt:
      `Using ${analyst}/semantic/metadata.json, list the join paths needed for the question you are given, the grain of each table, and any fan-out risk. Under 150 words. ` +
      "Send it to sem-lead with SendMessage.",
    tools: ["Read", "SendMessage"],
  },
  "sem-checker": {
    description: "Validates candidate SQL against the database.",
    prompt:
      `When asked to validate SQL, write it to ${runDir}/check.sql with Write, then run: ` +
      `node ${analyst}/validate_sql.mjs ${runDir}/check.sql . Report OK or the error, the row count, and the rows. Never change the database. ` +
      "Send the result to whoever asked, using SendMessage.",
    tools: ["Read", "Write", "Bash", "SendMessage"],
  },
  "biz-glossary": {
    description: "Lists the business terms a question uses.",
    prompt:
      `Read ${analyst}/business/glossary.md. For the question you are given, list each business term and its exact definition, in under 150 words. ` +
      "Send it to biz-lead with SendMessage.",
    tools: ["Read", "SendMessage"],
  },
  "biz-context": {
    description: "Lists the business rules that apply to a question.",
    prompt:
      `Read ${analyst}/business/context.md. List every rule that applies to the question you are given, quoting each rule number and text, under 200 words. ` +
      "Send it to biz-lead with SendMessage.",
    tools: ["Read", "SendMessage"],
  },
  "biz-metrics": {
    description: "Turns the question into a metric specification.",
    prompt:
      `Using ${analyst}/business, write a metric spec for the question you are given: grain, measures, filters, time windows, rounding, and ordering. Under 150 words. ` +
      "Send it to biz-lead with SendMessage.",
    tools: ["Read", "SendMessage"],
  },
  "biz-sqlwriter": {
    description: "Writes the SQL for a metric spec.",
    prompt:
      `Write one SELECT or WITH statement for the metric spec from biz-lead and the table facts from sem-lead. ` +
      `Save it with Write to ${finalSql}. Send the SQL text to biz-lead with SendMessage. Do not run the database yourself.`,
    tools: ["Read", "Write", "SendMessage"],
  },
};

const taskPrompt = [
  "Analyst question from the business user:",
  question,
  "",
  "Run both teams:",
  "1. Spawn 'sem-lead' and 'biz-lead' with the Agent tool. Set name and subagent_type to each lead's name, and set run_in_background to true.",
  "2. The leads spawn their own members and coordinate as described in their instructions.",
  `3. The final SQL must be saved to ${finalSql} and validated by the semantic team.`,
  "4. Wait for both leads to finish. Then report the final SQL and its validation result.",
].join("\n");

const log = [];
const models = new Set();
const usageById = new Map();
const started = Date.now();
let resultMeta = null;
let spawnCount = 0;
let finalText = null;
let error = null;

const preview = (s, n = 160) => (typeof s === "string" ? s : JSON.stringify(s)).replace(/\s+/g, " ").slice(0, n);

try {
  for await (const msg of query({
    prompt: taskPrompt,
    options: {
      systemPrompt:
        "You are the coordinator of two agent teams. Start both leads, then wait for their reports. Do not do the analysis yourself.",
      agents,
      allowedTools: ["Agent", "SendMessage", "Read", "Write", "Bash"],
      maxTurns: 80,
      teammateMode: "in-process",
    },
  })) {
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      if (msg.message?.model) models.add(msg.message.model);
      if (msg.message?.id && msg.message?.usage) {
        usageById.set(msg.message.id, {
          model: msg.message.model,
          origin: msg.parent_tool_use_id ? "subagent" : "main",
          ...msg.message.usage,
        });
      }
      for (const b of msg.message.content) {
        if (b.type !== "tool_use") continue;
        if (b.name === "Agent") {
          spawnCount++;
          log.push(`SPAWN name=${b.input?.name} type=${b.input?.subagent_type} model=${b.input?.model ?? "(not set)"}`);
        } else if (b.name === "SendMessage") {
          log.push(`MSG ${b.input?.to}: ${preview(b.input?.message, 200)}`);
        }
      }
    }
    if (msg.type === "result") {
      resultMeta = {
        duration_ms: msg.duration_ms,
        duration_api_ms: msg.duration_api_ms,
        num_turns: msg.num_turns,
        total_cost_usd: msg.total_cost_usd,
        usage: msg.usage,
        modelUsage: msg.modelUsage,
      };
      finalText = typeof msg.result === "string" ? msg.result : null;
      if (msg.is_error) error = `result subtype=${msg.subtype}`;
    }
  }
} catch (err) {
  error = String(err?.message ?? err).slice(0, 300);
}

// Grade: run the final SQL through the read-only checker and compare with the answer key.
let verdict = "NO FINAL SQL";
let got = null;
try {
  const checked = JSON.parse(
    execFileSync(process.execPath, [join(analyst, "validate_sql.mjs"), finalSql], { encoding: "utf8" }),
  );
  if (!checked.ok) {
    verdict = `SQL FAILED: ${checked.error}`;
  } else {
    const expected = JSON.parse(readFileSync(join(analyst, "_grader", "expected.json"), "utf8"))[qid];
    // Column names and order may differ; compare each row's values as a sorted set.
    const norm = (rows) => rows.map((r) => Object.values(r).map((v) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v))).sort());
    got = checked.rows;
    verdict = JSON.stringify(norm(checked.rows)) === JSON.stringify(norm(expected)) ? "MATCHES ANSWER KEY" : "RUNS BUT DIFFERS FROM ANSWER KEY";
  }
} catch {
  verdict = "NO FINAL SQL (file missing or unreadable)";
}

writeFileSync(join(runDir, "log.txt"), log.join("\n") + "\n");

// Token usage from streamed assistant messages, deduplicated by message id, split by origin.
const tokenKeys = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
const usageByOrigin = { main: { messages: 0 }, subagent: { messages: 0 } };
for (const k of tokenKeys) { usageByOrigin.main[k] = 0; usageByOrigin.subagent[k] = 0; }
for (const u of usageById.values()) {
  const bucket = usageByOrigin[u.origin];
  bucket.messages++;
  for (const k of tokenKeys) bucket[k] += u[k] ?? 0;
}
const metrics = {
  question: qid,
  wall_clock_ms: Date.now() - started,
  spawns: spawnCount,
  models: [...models],
  streamed_usage_by_origin: usageByOrigin,
  sdk_result: resultMeta,
};
writeFileSync(join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2));

console.log(`question: ${qid}`);
console.log(`models seen: ${[...models].join(", ") || "(none)"}`);
console.log(`agent spawns: ${spawnCount}`);
console.log(`wall clock: ${(metrics.wall_clock_ms / 1000).toFixed(1)} s`);
console.log(`sdk result: ${JSON.stringify(resultMeta)}`);
console.log(`streamed usage: ${JSON.stringify(usageByOrigin)}`);
console.log("\nSPAWNS AND MESSAGES:");
for (const l of log) console.log(" -", l);
console.log("\nFINAL REPORT:\n" + (finalText ?? "(none)"));
console.log("\nGRADE:", verdict);
if (got) console.log("ROWS:", JSON.stringify(got));
if (error) console.log("ERROR:", error);
