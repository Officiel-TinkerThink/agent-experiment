// Experiment: does the Claude Agent SDK draw from the subscription or an API key?
// Run: node auth_experiment.mjs
// Only prints auth-source metadata. Never prints key values.

import { query } from "@anthropic-ai/claude-agent-sdk";

const ROLES = [
  { name: "researcher", prompt: "In one sentence, name one benefit of unit tests." },
  { name: "critic", prompt: "In one sentence, name one risk of skipping code review." },
  { name: "summarizer", prompt: "In one sentence, summarize why version control matters." },
];

// Build an env with the API key variables removed.
function scrubbedEnv(extra = {}) {
  const env = { ...process.env, ...extra, ANTHROPIC_MODEL: "claude-haiku-5-5" };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

async function runAgent(role, env) {
  const report = { agent: role.name, initAuth: null, result: null, error: null, initKeys: null };
  try {
    for await (const msg of query({
      prompt: role.prompt,
      options: {
        maxTurns: 1,
        allowedTools: [],
        env,
      },
    })) {
      if (msg.type === "system" && msg.subtype === "init") {
        report.initKeys = Object.keys(msg).join(",");
        report.initAuth = msg.apiKeySource ?? "(field absent)";
      }
      if (msg.type === "result") {
        report.result = {
          subtype: msg.subtype,
          isError: msg.is_error,
          text: typeof msg.result === "string" ? msg.result.slice(0, 120) : null,
          costUsd: msg.total_cost_usd ?? null,
        };
      }
    }
  } catch (err) {
    report.error = String(err?.message ?? err).slice(0, 200);
  }
  return report;
}

async function runTeam(label, env) {
  console.log(`\n=== ${label} ===`);
  const reports = await Promise.all(ROLES.map((r) => runAgent(r, env)));
  for (const r of reports) {
    console.log(JSON.stringify(r, null, 2));
  }
  return reports;
}

// 1. Main run: no API key variables at all.
const main = await runTeam("MAIN: no API key env vars", scrubbedEnv());

// 2. Control run: a fake key set, to show what the SDK reports when a key is used.
const control = await runTeam(
  "CONTROL: fake ANTHROPIC_API_KEY set (expect auth failure or key source)",
  scrubbedEnv({ ANTHROPIC_API_KEY: "sk-ant-fake-control-not-real" }),
);

const mainOk = main.every((r) => r.result && !r.result.isError && !r.error);
console.log("\n=== SUMMARY ===");
console.log("main team ok without key:", mainOk);
console.log("main apiKeySource values:", [...new Set(main.map((r) => r.initAuth))]);
console.log("control apiKeySource values:", [...new Set(control.map((r) => r.initAuth))]);
console.log("control errors:", control.map((r) => r.error ?? r.result?.subtype));
