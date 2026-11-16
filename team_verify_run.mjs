// Verification run: log every SDK message so teammate deliveries are visible, not summarized.
// Run: node team_verify_run.mjs
// Runs on the Claude Code login; API key variables are removed.

import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const TASK =
  "Team task. Spawn alice and bob with the Agent tool, each exactly once, with name 'alice' and 'bob' and subagent_type 'alice' and 'bob', run_in_background true. " +
  "Then send alice's one-line definition of 'unit test' to bob using SendMessage (to 'bob'). " +
  "Ask bob to reply to alice with SendMessage (to 'alice') with a one-line check. " +
  "Wait until alice confirms she received bob's check, then report the exact text of every message received by lead, alice and bob.";

const agents = {
  alice: {
    description: "Writes one line defining 'unit test' and talks to teammates via SendMessage.",
    prompt:
      "Write one line defining 'unit test'. Send it to 'bob' with SendMessage. Wait for bob's reply to arrive, then report the exact text you received from bob.",
    tools: ["SendMessage"],
  },
  bob: {
    description: "Checks a definition and replies to teammates via SendMessage.",
    prompt:
      "When alice's definition arrives, check it in one sentence and send the check to 'alice' with SendMessage. Then report the exact text you sent.",
    tools: ["SendMessage"],
  },
};

function preview(s, n = 200) {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  return t.replace(/\s+/g, " ").slice(0, n);
}

let n = 0;
const log = [];
let finalText = null;
let error = null;

try {
  for await (const msg of query({
    prompt: TASK,
    options: {
      systemPrompt:
        "You are the team lead. Spawn each teammate once. Coordinate with SendMessage and wait for replies before finishing.",
      agents,
      allowedTools: ["Agent", "SendMessage", "TaskCreate", "TaskList", "TaskUpdate", "TaskStop"],
      maxTurns: 30,
      teammateMode: "in-process",
    },
  })) {
    n++;
    if (msg.type === "system" && msg.subtype === "init") {
      log.push(`[${n}] init apiKeySource=${msg.apiKeySource}`);
    } else if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      if (msg.message?.model) log.push(`[${n}] MODEL ${msg.message.model}`);
      for (const b of msg.message.content) {
        if (b.type === "tool_use") {
          const m = b.name === "Agent" ? ` spawn-model=${b.input?.model ?? "(not set)"}` : "";
          log.push(`[${n}] CALL ${b.name}${m} ${preview(b.input, 160)}`);
        } else if (b.type === "text" && b.text.trim()) {
          log.push(`[${n}] TEXT ${preview(b.text, 160)}`);
        }
      }
    } else if (msg.type === "user") {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_result") {
            log.push(`[${n}] RESULT ${preview(b.content, 200)}`);
          } else if (b.type === "text") {
            log.push(`[${n}] USER-TEXT ${preview(b.text, 200)}`);
          }
        }
      } else if (typeof content === "string") {
        log.push(`[${n}] USER ${preview(content, 200)}`);
      }
    } else if (msg.type === "result") {
      finalText = typeof msg.result === "string" ? msg.result : null;
      if (msg.is_error) error = `result subtype=${msg.subtype}`;
    } else {
      log.push(`[${n}] ${msg.type}${msg.subtype ? "/" + msg.subtype : ""}`);
    }
  }
} catch (err) {
  error = String(err?.message ?? err).slice(0, 300);
}

console.log(log.join("\n"));
console.log("\nFINAL:\n" + (finalText ?? "(none)"));
if (error) console.log("\nERROR:", error);
