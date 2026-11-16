// Experiment: does the Client SDK (Messages API) work without an API key?
// Run: node client_sdk_no_key.mjs
// Prints only status and error text. Never prints key values.

import Anthropic from "@anthropic-ai/sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

console.log("ANTHROPIC_API_KEY present:", "ANTHROPIC_API_KEY" in process.env);

try {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 50,
    messages: [{ role: "user", content: "Say hello in one word." }],
  });
  console.log("RESULT: success", JSON.stringify(msg.content).slice(0, 200));
} catch (err) {
  console.log("RESULT: error");
  console.log("  name:", err?.name);
  console.log("  status:", err?.status ?? "(none)");
  console.log("  message:", String(err?.message ?? err).slice(0, 300));
}
