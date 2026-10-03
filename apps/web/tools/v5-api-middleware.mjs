// Dev/preview-only middleware for the V5 one-character vertical slice.
//
// It maps the real public paths from `contracts/openapi/public-v2.yaml`
// (`/api/v2/*`) onto the sealed slice fixtures under
// `fixtures/v5/one-character-slice/api/`, so the browser exercises the final
// route paths and the final response shapes without a running service.
//
// It also owns the two document mount points, mirroring
// `deploy/study/Caddyfile`:
// - `/`, `/world`, `/people/*` -> the V5 slice shell (`world.html`).
// - `/study*`, `/research*`    -> the sealed research-v4 study (`index.html`).
// Anything else falls through to Vite, which runs with `appType: "mpa"` and
// therefore 404s instead of dropping a stray path into either app.
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

// Shared with `./v5-slice-api-bundle.mjs`, which writes the same route table into
// the release build, so the dev server and the release image answer the same
// paths with the same bytes.
export const API_PREFIX = "/api/v2/";

// The V5 slice shell. `world.html` keeps its filename so the release image and
// the dev server serve the same document at `/`.
const WORLD_SHELL_ENTRY = "/world.html";
// The sealed research-v4 study document. Its filename stays `index.html`
// (pinned by `tools/study-release-audit.mjs` and by the sealed service worker);
// only its public address moved to `/study`.
const STUDY_SHELL_ENTRY = "/index.html";

const WORLD_SHELL_PREFIXES = ["/world", "/people"];
const STUDY_SHELL_PREFIXES = ["/study", "/research"];

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

function matchesPrefix(prefixes, pathname) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Anything with a file extension is a static asset request, not a route.
// `/study-sw.js`, `/study-release.json` and `/manifest.webmanifest` therefore
// stay real files instead of being rewritten into the study document.
function looksLikeAsset(pathname) {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return lastSegment.includes(".");
}

/**
 * The document a route path must be served from, or `null` when the path is
 * not a route of either app (Vite then answers 404).
 */
export function resolveShellEntry(pathname) {
  if (pathname === "/") return WORLD_SHELL_ENTRY;
  if (looksLikeAsset(pathname)) return null;
  if (matchesPrefix(WORLD_SHELL_PREFIXES, pathname)) return WORLD_SHELL_ENTRY;
  if (matchesPrefix(STUDY_SHELL_PREFIXES, pathname)) return STUDY_SHELL_ENTRY;
  return null;
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

/**
 * The slice's route table (`index.json`: public path -> fixture file relative to
 * the fixture root), or `null` when it is missing or unreadable.
 */
export async function readRouteTable() {
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

/** Absolute fixture path for a route-table entry, or `null` when it leaves the fixture root. */
export function resolveFixtureFile(relativePath) {
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

    const shellEntry = resolveShellEntry(pathname);
    if (shellEntry) {
      req.url = shellEntry;
    }

    next();
  });
}

/**
 * Vite plugin serving the V5 slice fixtures on the real public API paths and
 * routing document requests to the slice shell (`/`, `/world`, `/people/*`) or
 * to the sealed study document (`/study*`, `/research*`).
 */
export function v5ApiMiddleware() {
  return {
    name: "panshi-v5-api-middleware",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
