// One Haiku call through strippedQuery(). No separate process is needed. The script exits when done.
// Run: node ask_wrapped.mjs
import { strippedQuery } from "./strip_wrap.mjs";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const t0 = Date.now();
let result = null;
for await (const msg of await strippedQuery({
  prompt: "Reply with one word: ok",
  options: { maxTurns: 1, model: "claude-haiku-5-5", tools: [], settingSources: [] },
})) {
  if (msg.type === "result") result = msg;
}
const u = result?.usage ?? {};
console.log("answer:", result?.result ?? null);
console.log("subtype:", result?.subtype ?? null, "is_error:", result?.is_error ?? null);
console.log("input tokens:", (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
  "| uncached:", u.input_tokens ?? 0, "cache write:", u.cache_creation_input_tokens ?? 0, "cache read:", u.cache_read_input_tokens ?? 0);
console.log("wall time (ms):", Date.now() - t0);
