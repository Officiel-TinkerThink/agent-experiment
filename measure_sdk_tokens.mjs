// Measures input tokens for a stripped Agent SDK call (no tools, custom system prompt, no settings sources).
// Run: node measure_sdk_tokens.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
// Always Haiku. settingSources: [] drops the user's /model default, so pin it in the environment too.
process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

const PROMPT = "Reply with one word: ok";
const variants = {
  "sdk-stripped": { tools: [], systemPrompt: "Reply with one word.", settingSources: [] },
  "sdk-default-system": { tools: [], settingSources: [] },
  "sdk-with-user-settings": { tools: [], systemPrompt: "Reply with one word.", settingSources: ["user"] },
};

for (const [name, extra] of Object.entries(variants)) {
  for (let i = 1; i <= 2; i++) {
    let u = null;
    let cost = null;
    let err = null;
    try {
      for await (const msg of query({ prompt: PROMPT, options: { maxTurns: 1, ...extra } })) {
        if (msg.type === "result") {
          u = msg.usage;
          cost = msg.total_cost_usd;
          if (msg.is_error) err = msg.subtype;
        }
      }
    } catch (e) {
      err = String(e?.message ?? e).slice(0, 200);
    }
    if (!u) {
      console.log(`${name} run ${i}: no usage (${err})`);
      continue;
    }
    const total = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
    console.log(
      `${name} run ${i}: input_total=${total} (new=${u.input_tokens}, cache_write=${u.cache_creation_input_tokens}, cache_read=${u.cache_read_input_tokens}) output=${u.output_tokens} cost=${cost}${err ? " error=" + err : ""}`,
    );
  }
}
