// Dynamic workflow test: the agent writes and runs a Workflow script through the Agent SDK.
// Run: node workflow_run.mjs
// Runs on the Claude Code login; API key variables are removed.

import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const TASK =
  "Use the Workflow tool. Write a small workflow that runs three agents in parallel, each writing one sentence " +
  "about a different database concept (index, transaction, view), then a final step that joins the three sentences " +
  "into one paragraph. Report the paragraph and the workflow's script path.";

const trace = [];
let resultMeta = null;
let finalText = null;
let error = null;
const started = Date.now();

try {
  for await (const msg of query({
    prompt: TASK,
    options: {
      allowedTools: ["Workflow"],
      settings: { enableWorkflows: true },
      maxTurns: 20,
    },
  })) {
    if (msg.type === "system" && msg.subtype === "init") {
      trace.push(`init apiKeySource=${msg.apiKeySource} model=${msg.model}`);
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type === "tool_use") {
          trace.push(`CALL ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`);
        }
      }
    }
    if (msg.type === "system" && msg.subtype && msg.subtype.includes("workflow")) {
      trace.push(`SYSTEM ${msg.subtype} ${JSON.stringify(msg).slice(0, 200)}`);
    }
    if (msg.type === "result") {
      finalText = typeof msg.result === "string" ? msg.result : null;
      resultMeta = { subtype: msg.subtype, is_error: msg.is_error, num_turns: msg.num_turns, total_cost_usd: msg.total_cost_usd };
      if (msg.is_error) error = `result subtype=${msg.subtype}`;
    }
  }
} catch (err) {
  error = String(err?.message ?? err).slice(0, 300);
}

console.log("wall clock:", ((Date.now() - started) / 1000).toFixed(1), "s");
console.log("trace:");
for (const t of trace) console.log(" -", t);
console.log("\nFINAL:\n" + (finalText ?? "(none)"));
console.log("\nresult:", JSON.stringify(resultMeta));
if (error) console.log("\nERROR:", error);
