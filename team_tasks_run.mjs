// Agent-team experiment: coordinator uses shared task list + SendMessage between teammates.
// Run: node team_tasks_run.mjs
// Runs on the Claude Code login; API key variables are removed.

import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const TASK =
  "Set up a small team to write a 2-line glossary of 'unit test' and 'integration test'. " +
  "Create tasks in the shared task list for each term. " +
  "Spawn two agents with the Agent tool, setting the name parameter to 'alice' (writes the unit test line) and 'bob' (writes the integration test line), and set run_in_background to true. " +
  "Once both are running, use SendMessage with to set to 'bob' to send alice's line to bob. " +
  "Ask bob to reply to alice with SendMessage (to 'alice') containing a one-line check. " +
  "Then mark the tasks complete and report the final glossary plus every SendMessage you sent and received.";

const ALLOWED = [
  "Agent",
  "SendMessage",
  "TaskCreate",
  "TaskList",
  "TaskGet",
  "TaskUpdate",
  "TaskStop",
];

const trace = [];
let initInfo = null;
let finalText = null;
let error = null;

try {
  for await (const msg of query({
    prompt: TASK,
    options: {
      systemPrompt:
        "You are the team lead. Use the task tools to track work and the Agent tool to start teammates. Keep it small.",
      allowedTools: ALLOWED,
      maxTurns: 20,
      teammateMode: "in-process",
    },
  })) {
    if (msg.type === "system" && msg.subtype === "init") {
      initInfo = { apiKeySource: msg.apiKeySource, tools: msg.tools?.length ?? null };
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type === "tool_use") {
          trace.push(`${b.name} ${JSON.stringify(b.input).slice(0, 110)}`);
        }
      }
    }
    if (msg.type === "result") {
      finalText = typeof msg.result === "string" ? msg.result : null;
      if (msg.is_error) error = `result subtype=${msg.subtype}`;
    }
  }
} catch (err) {
  error = String(err?.message ?? err).slice(0, 300);
}

console.log("init:", JSON.stringify(initInfo));
console.log("\nTool calls (" + trace.length + "):");
for (const t of trace) console.log(" -", t);
console.log("\nFinal:\n" + (finalText ?? "(none)"));
if (error) console.log("\nError:", error);
