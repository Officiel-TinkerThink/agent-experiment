// Counts the tokens of a text file as the API sees it, on Haiku 5.5.
// Usage: node count_tokens_text.mjs <path-to-text-file>
// Method: send the file's text as the prompt of a stripped Agent SDK call (no tools, no settings sources),
// then subtract the same call's usage for the one-word prompt "ok". The harness overhead is in both,
// so the difference is the file's own token count. Totals include cache reads and writes.
import { readFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

async function inputTotal(prompt) {
  let total = null;
  for await (const msg of query({
    prompt,
    options: { maxTurns: 1, tools: [], settingSources: [], model: "claude-haiku-5-5" },
  })) {
    if (msg.type === "result") {
      const u = msg.usage;
      total = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
    }
  }
  return total;
}

const path = process.argv[2];
if (!path) {
  console.error("usage: node count_tokens_text.mjs <file>");
  process.exit(1);
}
const text = readFileSync(path, "utf8");
const baseline = await inputTotal("ok");
const withText = await inputTotal(text);
console.log(`file: ${path}`);
console.log(`characters: ${text.length}`);
console.log(`baseline call (prompt "ok"): ${baseline} input tokens`);
console.log(`call with file text: ${withText} input tokens`);
console.log(`tokens of the file text: ${withText - baseline}`);
