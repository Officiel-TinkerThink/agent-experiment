// Latency and input-token benchmark for one mode per process.
// Run: node bench_latency.mjs <direct|wrapper|daemon> [runs]
// direct:  no proxy, injected context kept (baseline)
// wrapper: strippedQuery(), strip server inside this process
// daemon:  ANTHROPIC_BASE_URL=http://127.0.0.1:8787 (start strip_daemon.mjs first)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { strippedQuery } from "./strip_wrap.mjs";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const mode = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
const baseOptions = { maxTurns: 1, model: "claude-haiku-5-5", tools: [], settingSources: [] };
const memoryOff = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" };

async function runOnce() {
  const t0 = performance.now();
  let result = null;
  if (mode === "wrapper") {
    for await (const msg of await strippedQuery({ prompt: "Reply with one word: ok", options: baseOptions })) {
      if (msg.type === "result") result = msg;
    }
  } else {
    const env = { ...process.env, ...memoryOff, ANTHROPIC_MODEL: "claude-haiku-5-5" };
    if (mode === "daemon") env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8787";
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    for await (const msg of query({ prompt: "Reply with one word: ok", options: { ...baseOptions, env } })) {
      if (msg.type === "result") result = msg;
    }
  }
  const ms = performance.now() - t0;
  const u = result?.usage ?? {};
  const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return { ms, tokens, ok: result?.is_error === false };
}

const rows = [];
for (let i = 0; i < runs; i++) rows.push(await runOnce());
const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
console.log(JSON.stringify({
  mode,
  runs,
  allOk: rows.every((r) => r.ok),
  firstMs: Math.round(rows[0].ms),
  medianMs: Math.round(median),
  meanMs: Math.round(mean),
  minMs: Math.round(sorted[0]),
  maxMs: Math.round(sorted[sorted.length - 1]),
  inputTokens: rows.map((r) => r.tokens),
}));
