// Team experiment: a coordinator agent delegates to two specialist subagents
// (drafter and reviewer) through the Agent SDK, then returns a final answer.
// Run: node team_run.mjs
// No API key is passed in; runs on the Claude Code login.

import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const TASK =
  "Write a short 3-bullet explanation of what a unit test is for a beginner. " +
  "First have the drafter write the bullets, then have the reviewer check them for accuracy and clarity, " +
  "then return the final bullets.";

const agents = {
  drafter: {
    description: "Writes a first draft of short explanations.",
    prompt: "You write a concise draft as exactly the requested number of bullet points. No preamble.",
    tools: [],
  },
  reviewer: {
    description: "Checks drafts for factual accuracy and clarity and returns a corrected version.",
    prompt: "You check the draft for accuracy and clarity. Return the corrected bullets only.",
    tools: [],
  },
};

const toolCalls = [];
let finalText = null;
let initAuth = null;
let error = null;

try {
  for await (const msg of query({
    prompt: TASK,
    options: {
      systemPrompt:
        "You are the coordinator of a small team. Delegate drafting to the drafter subagent and checking to the reviewer subagent, then return the final result.",
      agents,
      maxTurns: 6,
    },
  })) {
    if (msg.type === "system" && msg.subtype === "init") {
      initAuth = msg.apiKeySource;
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          toolCalls.push({ name: block.name, input: JSON.stringify(block.input).slice(0, 120) });
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

console.log("apiKeySource:", initAuth);
console.log("\nDelegation calls made by coordinator:");
for (const t of toolCalls) console.log(" -", t.name, t.input);
console.log("\nFinal answer:\n" + (finalText ?? "(none)"));
if (error) console.log("\nError:", error);
