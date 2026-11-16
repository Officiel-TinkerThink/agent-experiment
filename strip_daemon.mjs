// Shared local proxy: strips injected context from every /v1/messages request, then forwards it.
// Start once and leave it running:  node strip_daemon.mjs
// Point each script at it:          ANTHROPIC_BASE_URL=http://127.0.0.1:8787
// Env switches for the daemon (read at start):
//   STRIP_PORT=8787                     port on 127.0.0.1
//   STRIP_UPSTREAM=https://api.anthropic.com   where requests go (a mock URL for tests)
//   STRIP_REMINDERS=0 / STRIP_ENV=0     keep those blocks
//   STRIP_SYSTEM=1                      also remove the system prompt
// Other paths are forwarded unchanged. Headers are never logged or written to disk.
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { stripBody } from "./strip_core.mjs";

export function createStripServer({ upstream = "https://api.anthropic.com", opts = {}, onStrip } = {}) {
  const up = new URL(upstream);
  const lib = up.protocol === "https:" ? https : http;
  // Keep upstream connections open between calls, so each request skips the TLS handshake.
  const agent = new lib.Agent({ keepAlive: true, maxSockets: 64 });
  const basePath = up.pathname.replace(/\/$/, "");

  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      const headers = { ...req.headers, host: up.host };
      delete headers["transfer-encoding"];
      if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
        try {
          const out = stripBody(body.toString("utf8"), opts);
          body = Buffer.from(out.body, "utf8");
          headers["content-length"] = String(body.length);
          if (onStrip) onStrip(out.report);
        } catch (e) {
          // Not JSON: forward unchanged.
        }
      }
      const upReq = lib.request(
        { protocol: up.protocol, hostname: up.hostname, port: up.port || undefined, path: basePath + req.url, method: req.method, headers, agent },
        (ur) => {
          res.writeHead(ur.statusCode ?? 502, ur.headers);
          ur.pipe(res);
        },
      );
      upReq.on("error", (e) => {
        if (!res.headersSent) res.writeHead(502);
        res.end(String(e.message));
      });
      upReq.end(body);
    });
  });
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.STRIP_PORT ?? 8787);
  const opts = {
    reminders: process.env.STRIP_REMINDERS !== "0",
    env: process.env.STRIP_ENV !== "0",
    system: process.env.STRIP_SYSTEM === "1",
  };
  const log = process.env.STRIP_LOG === "1";
  const server = createStripServer({
    upstream: process.env.STRIP_UPSTREAM ?? "https://api.anthropic.com",
    opts,
    // STRIP_LOG=1 prints what was removed from each request (counts and sizes only, never content).
    onStrip: log ? (r) => console.log("stripped:", JSON.stringify(r)) : undefined,
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`strip daemon on http://127.0.0.1:${port}`, JSON.stringify(opts));
  });
}
