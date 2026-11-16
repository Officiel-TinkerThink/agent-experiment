// One Haiku call through the shared strip daemon (start it first: node strip_daemon.mjs).
// Run: node ask_via_daemon.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const base = process.env.STRIP_BASE_URL ?? "http://127.0.0.1:8787";
const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: base,
  ANTHROPIC_MODEL: "claude-haiku-5-5",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
};
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

const t0 = Date.now();
let result = null;
for await (const msg of query({
  prompt: "Reply with one word: ok",
  options: { maxTurns: 1, model: "claude-haiku-5-5", tools: [], settingSources: [], env },
})) {
  if (msg.type === "result") result = msg;
}
const u = result?.usage ?? {};
console.log("answer:", result?.result ?? null);
console.log("subtype:", result?.subtype ?? null, "is_error:", result?.is_error ?? null);
console.log("input tokens:", (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
  "| uncached:", u.input_tokens ?? 0, "cache write:", u.cache_creation_input_tokens ?? 0, "cache read:", u.cache_read_input_tokens ?? 0);
console.log("wall time (ms):", Date.now() - t0);
