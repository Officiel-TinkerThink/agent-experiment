// Diagnostic: capture the (already stripped) request bodies of one agent question and print
// where the input characters go. Usage: node agent/diag_capture.mjs <variant>
import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const bodies = [];
const cap = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.url.startsWith("/v1/messages")) bodies.push(body.toString("utf8"));
    const up = https.request({ hostname: "api.anthropic.com", port: 443, path: req.url, method: req.method, headers: { ...req.headers, host: "api.anthropic.com" } }, (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      ur.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e.message)); });
    up.end(body);
  });
});
await new Promise((r) => cap.listen(0, "127.0.0.1", r));
process.env.STRIP_UPSTREAM = `http://127.0.0.1:${cap.address().port}`;

const { strippedQuery } = await import("../../strip_wrap.mjs");
const { Context } = await import("./context.mjs");
const { makeQuestionTools } = await import("./tools.mjs");
const { VARIANTS } = await import("./variants.mjs");
const variant = VARIANTS[process.argv[2] ?? "v1_closure"];
const train = JSON.parse(readFileSync(join(ROOT, "data/split/train.json"), "utf8"));
const folds = JSON.parse(readFileSync(join(ROOT, "data/split/train_folds.json"), "utf8"));
const item = train.find((d) => d.question_id === folds.dev[0]);
const ctx = new Context(item.db_id, variant.learned ? "learn" : null);
const state = { exploreCalls: 0, sqlCalls: 0, submits: 0, finalSql: null, seen: [] };
for await (const msg of await strippedQuery({
  prompt: variant.prompt(item.question, ctx),
  options: { systemPrompt: variant.system(ctx), model: "claude-haiku-5-5", tools: [], mcpServers: { db: makeQuestionTools(ctx, state) },
    allowedTools: ["mcp__db__explore", "mcp__db__submit_sql"], maxTurns: 14, settingSources: [], persistSession: false, strictMcpConfig: true, title: "q" },
})) { /* drain */ }
cap.close();

writeFileSync("/tmp/claude-1000/-home-bornouksyn-projects-agent-experiment/faa35e14-1436-4744-9e7c-f52fbe0bb2b9/scratchpad/agent_bodies.json", JSON.stringify(bodies));
const len = (x) => JSON.stringify(x ?? "").length;
bodies.forEach((raw, i) => {
  const b = JSON.parse(raw);
  const tools = (b.tools ?? []).map((t) => `${t.name}:${len(t)}`);
  const msgs = (b.messages ?? []).map((m) => `${m.role}:${len(m.content)}`);
  console.log(`request ${i}: model ${b.model} system ${len(b.system)} tools [${tools.join(", ")}] messages [${msgs.join(", ")}] total ${raw.length}`);
});
