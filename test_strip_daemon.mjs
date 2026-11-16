// Tests the strip daemon against a local mock upstream. No API calls are made.
// Run: node test_strip_daemon.mjs <path to a captured strip_capture.json>
import http from "node:http";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createStripServer } from "./strip_daemon.mjs";
import { stripBody } from "./strip_core.mjs";

const capturePath = process.argv[2];
const captured = JSON.parse(readFileSync(capturePath, "utf8"));
const original = captured.find((c) => c.original.includes("<system-reminder>")).original;

// Mock upstream: records what it received and answers with a fixed JSON body.
const received = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    received.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;

const reports = [];
const daemon = createStripServer({
  upstream: mockUrl,
  opts: { reminders: true, env: true, system: false },
  onStrip: (r) => reports.push(r),
});
await new Promise((r) => daemon.listen(0, "127.0.0.1", r));
const daemonUrl = `http://127.0.0.1:${daemon.address().port}`;

async function post(base, body) {
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-not-real" },
    body,
  });
  return r.json();
}

// 1. Correctness: the body the mock receives is stripped, and its length header matches.
await post(daemonUrl, original);
const got = received[received.length - 1];
const gotBody = got.body;
const parsed = JSON.parse(gotBody);
const checks = {
  noReminders: !gotBody.includes("<system-reminder>"),
  noEnvironment: !gotBody.includes("# Environment"),
  promptKept: gotBody.includes("Reply with one word: ok"),
  contentLengthMatches: Number(got.headers["content-length"]) === Buffer.byteLength(gotBody),
  systemKept: Array.isArray(parsed.system) && parsed.system.length === 2,
  hostRewritten: got.headers.host === new URL(mockUrl).host,
};
console.log("forwarded body bytes:", Buffer.byteLength(gotBody), "original bytes:", Buffer.byteLength(original));
console.log("checks:", JSON.stringify(checks));
console.log("all checks pass:", Object.values(checks).every(Boolean));

// 2. Cost of the strip step alone, per call.
const N = 2000;
let t0 = performance.now();
for (let i = 0; i < N; i++) stripBody(original, { reminders: true, env: true, system: false });
const stripMs = (performance.now() - t0) / N;
console.log("strip step, avg per call (ms):", stripMs.toFixed(4));

// 3. Added round-trip time: direct to mock vs through the daemon.
async function timeRuns(base, runs) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await post(base, original);
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(runs / 2)], mean: times.reduce((a, b) => a + b, 0) / runs };
}
// Warm both paths first so connection setup is not counted.
await timeRuns(mockUrl, 5);
await timeRuns(daemonUrl, 5);
const direct = await timeRuns(mockUrl, 100);
const viaDaemon = await timeRuns(daemonUrl, 100);
console.log("direct to mock, median/mean (ms):", direct.median.toFixed(2), direct.mean.toFixed(2));
console.log("via daemon, median/mean (ms):", viaDaemon.median.toFixed(2), viaDaemon.mean.toFixed(2));
console.log("added by daemon, median (ms):", (viaDaemon.median - direct.median).toFixed(2));

daemon.close();
mock.close();
