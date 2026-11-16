// Measures SDK startup latency: time to the init message, and total time for a one-word reply.
// Run: node startup_timing.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const RUNS = 3;
for (let i = 1; i <= RUNS; i++) {
  const t0 = Date.now();
  let tInit = null;
  let tEnd = null;
  let apiMs = null;
  for await (const msg of query({
    prompt: "Reply with one word: ok",
    options: { maxTurns: 1, allowedTools: [] },
  })) {
    if (msg.type === "system" && msg.subtype === "init" && tInit === null) tInit = Date.now() - t0;
    if (msg.type === "result") {
      tEnd = Date.now() - t0;
      apiMs = msg.duration_api_ms;
    }
  }
  console.log(`run ${i}: time to init ${tInit} ms, total ${tEnd} ms, api time ${apiMs} ms`);
}
