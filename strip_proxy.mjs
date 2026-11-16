// Local pass-through proxy that removes injected context from the Agent SDK request before it is sent.
// Run: node strip_proxy.mjs [outDir]
// Env switches (default in brackets):
//   STRIP_REMINDERS=0   keep text blocks that start with <system-reminder>  [removed]
//   STRIP_ENV=0         keep the "# Environment" block                      [removed]
//   STRIP_SYSTEM=1      also remove the top-level system prompt             [kept]
// The proxy changes only the /v1/messages body. Every other request is forwarded unchanged.
// Headers, including credentials, are never written to disk. The saved file holds bodies only.
import http from "node:http";
import https from "node:https";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const outDir = process.argv[2] ?? "/tmp/claude-1000/-home-bornouksyn-projects-agent-experiment/faa35e14-1436-4744-9e7c-f52fbe0bb2b9/scratchpad/strip_proxy";
mkdirSync(outDir, { recursive: true });

const STRIP_REMINDERS = process.env.STRIP_REMINDERS !== "0";
const STRIP_ENV = process.env.STRIP_ENV !== "0";
const STRIP_SYSTEM = process.env.STRIP_SYSTEM === "1";

function injectedKind(text) {
  if (STRIP_REMINDERS && text.startsWith("<system-reminder>")) return "reminder";
  if (STRIP_ENV && text.startsWith("# Environment")) return "environment";
  return null;
}

// Returns the new body text and a report of what was removed.
function stripBody(raw) {
  const b = JSON.parse(raw);
  const report = { removed: [], removedChars: 0, systemRemoved: false };
  const messages = [];
  for (const m of b.messages ?? []) {
    if (typeof m.content === "string") {
      messages.push(m);
      continue;
    }
    const kept = [];
    for (const blk of m.content) {
      const kind = blk.type === "text" ? injectedKind(blk.text) : null;
      if (kind) {
        report.removed.push(kind);
        report.removedChars += blk.text.length;
        continue;
      }
      kept.push(blk);
    }
    // A message whose only blocks were removed is dropped, so the API never sees an empty content list.
    if (kept.length > 0) messages.push({ ...m, content: kept });
  }
  b.messages = messages;
  if (STRIP_SYSTEM && b.system !== undefined) {
    delete b.system;
    report.systemRemoved = true;
  }
  return { body: JSON.stringify(b), report };
}

const captured = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: "api.anthropic.com" };
    if (req.url.startsWith("/v1/messages") && req.method === "POST") {
      try {
        const raw = body.toString("utf8");
        const { body: newText, report } = stripBody(raw);
        captured.push({ url: req.url, original: raw, forwarded: newText, report });
        body = Buffer.from(newText, "utf8");
        headers["content-length"] = String(body.length);
      } catch (e) {
        // Not JSON: forward unchanged.
      }
    }
    const up = https.request(
      { hostname: "api.anthropic.com", port: 443, path: req.url, method: req.method, headers },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        const logThis = req.url.startsWith("/v1/messages");
        const got = [];
        ur.on("data", (c) => {
          if (logThis) got.push(c);
          res.write(c);
        });
        ur.on("end", () => {
          if (logThis) {
            const text = Buffer.concat(got).toString("utf8");
            console.error("upstream status:", ur.statusCode, "first bytes:", text.slice(0, 400));
          }
          res.end();
        });
      },
    );
    up.on("error", (e) => {
      res.writeHead(502);
      res.end(String(e.message));
    });
    up.end(body);
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  ANTHROPIC_MODEL: "claude-haiku-5-5",
  // Turn off auto-memory and CLAUDE.md loading (verified to remove the memory reminder).
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
};
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

let result = null;
let error = null;
try {
  for await (const msg of query({
    prompt: "Reply with one word: ok",
    options: { maxTurns: 1, model: "claude-haiku-5-5", tools: [], settingSources: [], env },
  })) {
    if (msg.type === "result") result = { subtype: msg.subtype, text: msg.result, usage: msg.usage };
  }
} catch (e) {
  error = String(e?.message ?? e).slice(0, 300);
}
server.close();

const u = result?.usage ?? {};
const inputTotal = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
const file = join(outDir, "strip_capture.json");
writeFileSync(file, JSON.stringify(captured, null, 2));
console.log("requests seen:", captured.length);
console.log("switches: reminders", STRIP_REMINDERS, "env", STRIP_ENV, "system", STRIP_SYSTEM);
for (const c of captured) {
  console.log("removed blocks:", JSON.stringify(c.report.removed), "chars:", c.report.removedChars, "system removed:", c.report.systemRemoved);
}
console.log("answer:", result?.text ?? null);
console.log("input tokens this call:", inputTotal);
console.log("saved to:", file);
if (error) console.log("error:", error);
