// Captures the exact request body the Agent SDK sends to the API, using a local pass-through proxy.
// Run: node capture_request.mjs
// The proxy forwards every request unchanged to api.anthropic.com and records the body only.
// Headers, including credentials, are never written to disk.
import http from "node:http";
import https from "node:https";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const outDir = process.argv[2] ?? "/tmp/claude-1000/-home-bornouksyn-projects-agent-experiment/faa35e14-1436-4744-9e7c-f52fbe0bb2b9/scratchpad";
mkdirSync(outDir, { recursive: true });
const captured = [];

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.url.startsWith("/v1/messages")) {
      captured.push({ method: req.method, url: req.url, body: body.toString("utf8") });
    }
    const up = https.request(
      { hostname: "api.anthropic.com", port: 443, path: req.url, method: req.method, headers: { ...req.headers, host: "api.anthropic.com" } },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
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
const env = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` };
if (process.env.CAPTURE_ENV_MODEL) env.ANTHROPIC_MODEL = "claude-haiku-5-5";
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

let result = null;
let error = null;
try {
  for await (const msg of query({
    prompt: "Reply with one word: ok",
    // settingSources: [] drops the user's /model default, so the model is pinned explicitly.
    options: process.env.CAPTURE_PLAIN
      ? { maxTurns: 1, env }
      : process.env.CAPTURE_ENV_MODEL
        ? { maxTurns: 1, tools: [], settingSources: [], env }
        : { maxTurns: 1, model: "claude-haiku-5-5", tools: [], settingSources: [], env },
  })) {
    if (msg.type === "result") result = { subtype: msg.subtype, text: msg.result, usage: msg.usage };
  }
} catch (e) {
  error = String(e?.message ?? e).slice(0, 300);
}
server.close();

const file = join(outDir, "request_capture.json");
writeFileSync(file, JSON.stringify(captured, null, 2));
console.log("captured requests:", captured.length);
console.log("saved to:", file);
console.log("result:", JSON.stringify(result));
if (error) console.log("error:", error);
