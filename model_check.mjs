// Checks which model the Agent SDK reports for a plain query with no model set.
// Run: node model_check.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

let model = null;
let answer = null;
for await (const msg of query({ prompt: "Reply with one word: ok", options: { maxTurns: 1, allowedTools: [] } })) {
  if (msg.type === "system" && msg.subtype === "init") model = msg.model;
  if (msg.type === "assistant" && msg.message?.model) model = msg.message.model;
  if (msg.type === "result") answer = msg.result;
}
console.log("model:", model);
console.log("answer:", answer);
