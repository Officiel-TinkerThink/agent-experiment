// Messaging experiment: custom teammate agents that have SendMessage in their own tool list.
// Run: node team_messaging_run.mjs
// Runs on the Claude Code login; API key variables are removed.

import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const TASK =
  "Team task: alice writes one line defining 'unit test'. bob writes one line defining 'integration test'. " +
  "Spawn alice and bob with the Agent tool, using subagent_type 'alice' and 'bob' and name 'alice' and 'bob', run_in_background true, exactly once each. " +
  "Then send alice's line to bob with SendMessage (to 'bob'). Ask bob to send a one-line check back to alice with SendMessage (to 'alice'). " +
  "Report the glossary and list each SendMessage sent and received, quoting the text.";

const agents = {
  alice: {
    description: "Writes one line defining 'unit test' and can message teammates.",
    prompt:
      "Write one line defining 'unit test'. Then send it to 'bob' with SendMessage. Wait for bob's reply if messages arrive, then finish with a short report.",
    tools: ["SendMessage"],
  },
  bob: {
    description: "Writes one line defining 'integration test' and can message teammates.",
    prompt:
      "Write one line defining 'integration test'. When you receive alice's line, check it in one sentence and send the check to 'alice' with SendMessage. Then finish with a short report.",
    tools: ["SendMessage"],
  },
};

const trace = [];
let initInfo = null;
let finalText = null;
let error = null;

try {
  for await (const msg of query({
    prompt: TASK,
    options: {
      systemPrompt:
        "You are the team lead. Spawn exactly the two named teammates once each, then coordinate messages. Be brief.",
      agents,
      allowedTools: ["Agent", "SendMessage", "TaskCreate", "TaskList", "TaskUpdate", "TaskStop"],
      maxTurns: 20,
      teammateMode: "in-process",
    },
  })) {
    if (msg.type === "system" && msg.subtype === "init") {
      initInfo = { apiKeySource: msg.apiKeySource };
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        if (b.type === "tool_use") {
          trace.push(`${b.name} ${JSON.stringify(b.input).slice(0, 140)}`);
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
