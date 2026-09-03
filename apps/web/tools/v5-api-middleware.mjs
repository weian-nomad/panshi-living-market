// Dev/preview-only middleware for the V5 one-character vertical slice.
//
// It maps the real public paths from `contracts/openapi/public-v2.yaml`
// (`/api/v2/*`) onto the sealed slice fixtures under
// `fixtures/v5/one-character-slice/api/`, so the browser exercises the final
// route paths and the final response shapes without a running service.
//
// Fail-closed rules (docs/v5/product-constitution.md, AGENTS.md):
// - A missing index, a missing route entry, or a missing file is a 404
//   `application/problem+json`, never an empty object and never a placeholder
//   payload.
// - Nothing outside the fixture directory is ever read, and no absolute
//   repository path is ever written into a response body.

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../../fixtures/v5/one-character-slice/api");
const FIXTURE_INDEX = path.join(FIXTURE_ROOT, "index.json");

const API_PREFIX = "/api/v2/";
const SHELL_ENTRY = "/world.html";
const SHELL_PREFIXES = ["/world", "/people"];

function requestPathname(rawUrl) {
  const url = rawUrl ?? "/";
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function normalizePathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

function isShellPath(pathname) {
  const matchesPrefix = SHELL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!matchesPrefix) return false;
  // Anything with a file extension is a static asset request, not a route.
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !lastSegment.includes(".");
}

// The requested path is deliberately not echoed back: the response must stay
// free of local repository paths.
function problemNotFound() {
  return {
    type: "/problems/unknown-resource",
    title: "找不到這個資源",
    status: 404,
    reasonCode: "UNKNOWN_RESOURCE",
    traceId: randomUUID(),
  };
}

function sendProblem(res) {
  const body = JSON.stringify(problemNotFound());
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/problem+json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

async function readRouteTable() {
  // Re-read on every request: regenerating the fixtures must not require a
  // dev-server restart.
  let raw;
  try {
    raw = await readFile(FIXTURE_INDEX, "utf8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const routes = parsed?.routes;
  if (!routes || typeof routes !== "object") return null;
  return routes;
}

function resolveFixtureFile(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  const resolved = path.resolve(FIXTURE_ROOT, relativePath);
  if (resolved !== FIXTURE_ROOT && !resolved.startsWith(`${FIXTURE_ROOT}${path.sep}`)) {
    return null;
  }
  return resolved;
}

async function handleApiRequest(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendProblem(res);
    return;
  }

  const routes = await readRouteTable();
  const relativePath = routes ? routes[pathname] : undefined;
  const fixtureFile = relativePath === undefined ? null : resolveFixtureFile(relativePath);
  if (!fixtureFile) {
    sendProblem(res);
    return;
  }

  let payload;
  try {
    payload = await readFile(fixtureFile, "utf8");
  } catch {
    sendProblem(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(req.method === "HEAD" ? undefined : payload);
}

function attach(server) {
  server.middlewares.use((req, res, next) => {
    const pathname = normalizePathname(requestPathname(req.url));

    if (pathname.startsWith(API_PREFIX)) {
      handleApiRequest(req, res, pathname).catch(() => {
        sendProblem(res);
      });
      return;
    }

    if (isShellPath(pathname)) {
      req.url = SHELL_ENTRY;
    }

    next();
  });
}

/**
 * Vite plugin serving the V5 slice fixtures on the real public API paths and
 * falling back to the slice shell entry for world/people routes.
 */
export function v5ApiMiddleware() {
  return {
    name: "panshi-v5-api-middleware",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
