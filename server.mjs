import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleHooksRequest } from "./lib/hooks-http.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const apiBase = (process.env.TASKMARKET_API_URL || "https://api.taskmarket.dev").replace(/\/$/, "");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const allowedPrefixes = [
  "/tasks",
  "/market/stats",
  "/agents/count",
  "/agents/leaderboard",
  "/stats/platform-time-series",
  "/health",
];

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function proxyTaskmarket(req, res, url) {
  const remotePath = url.pathname.replace(/^\/api\/taskmarket/, "") || "/";
  if (!allowedPrefixes.some((prefix) => remotePath === prefix || remotePath.startsWith(`${prefix}/`))) {
    sendJson(res, 404, { error: "Endpoint is not proxied by this dashboard." });
    return;
  }

  const upstreamUrl = `${apiBase}/api${remotePath}${url.search}`;
  const startedAt = Date.now();

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const body = await upstream.text();

    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-taskmarket-api": apiBase,
      "x-dashboard-proxy-ms": String(Date.now() - startedAt),
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach Taskmarket API.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    const body = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": mimeTypes[".html"],
      "cache-control": "no-cache",
    });
    res.end(body);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/hooks" || url.pathname === "/api/hooks/") {
    await handleHooksRequest(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  if (url.pathname.startsWith("/api/taskmarket")) {
    await proxyTaskmarket(req, res, url);
    return;
  }

  await serveStatic(res, url.pathname);
});

server.listen(port, () => {
  console.log(`Taskmarket Hooklist: http://localhost:${port}`);
  console.log(`Taskmarket API: ${apiBase}`);
});
