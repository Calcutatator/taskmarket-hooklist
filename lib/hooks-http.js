import { getHookRegistry } from "./registry-service.js";

export const HOOKS_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

function setCommonHeaders(res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", HOOKS_CACHE_CONTROL);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("x-content-type-options", "nosniff");
}

function sendJson(res, statusCode, body, { head = false } = {}) {
  setCommonHeaders(res);
  res.statusCode = statusCode;
  res.end(head ? undefined : JSON.stringify(body));
}

export async function handleHooksRequest(req, res, { getRegistry = getHookRegistry } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    sendJson(res, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "Only GET and HEAD are supported.",
    });
    return;
  }

  try {
    const registry = await getRegistry();
    sendJson(res, 200, registry, { head: method === "HEAD" });
  } catch {
    sendJson(res, 503, {
      error: "HOOK_REGISTRY_UNAVAILABLE",
      message: "The public hook registry is temporarily unavailable.",
    }, { head: method === "HEAD" });
  }
}
