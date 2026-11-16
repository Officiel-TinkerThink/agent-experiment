// Wrapper around the Agent SDK's query() that strips injected context, with no separate process.
// The strip server runs inside the same Node process as your script. It starts on the first call,
// listens on a random 127.0.0.1 port, and is unref'd, so it does not keep the script alive.
// When the script exits, the server goes with it.
// Usage:
//   import { strippedQuery } from "./strip_wrap.mjs";
//   for await (const msg of await strippedQuery({ prompt, options })) { ... }
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createStripServer } from "./strip_daemon.mjs";

let baseUrlPromise = null;

function ensureServer(stripOpts) {
  if (baseUrlPromise === null) {
    baseUrlPromise = new Promise((resolve, reject) => {
      const server = createStripServer({
        upstream: process.env.STRIP_UPSTREAM ?? "https://api.anthropic.com",
        opts: stripOpts,
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve(`http://127.0.0.1:${server.address().port}`);
      });
    });
  }
  return baseUrlPromise;
}

export async function strippedQuery({ prompt, options = {}, stripOpts = { reminders: true, env: true, system: false } }) {
  const base = await ensureServer(stripOpts);
  const env = {
    ...(options.env ?? process.env),
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_MODEL: options.model ?? "claude-haiku-5-5",
    // Turn off auto-memory and CLAUDE.md loading (verified to remove the memory reminder).
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    // Keep the account's claude.ai connectors (e.g. Docs) out of the agent's tools.
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return query({ prompt, options: { ...options, env } });
}
