// Build-time bundling of the V5 one-character slice API into the release build.
//
// In dev/preview `./v5-api-middleware.mjs` answers `/api/v2/*` from the sealed
// slice fixtures. A release image has no Node process, so `vite build` writes
// the same route table into `dist/` and the image's Caddyfile serves it
// (`deploy/preview/Caddyfile`).
//
// One mapping rule, shared by all three:
//
//   public path  /api/v2/<rest>   ->   dist file  api/v2/<rest>.json
//
// - The middleware reads `fixtures/v5/one-character-slice/api/index.json` and
//   answers each listed path with the listed file's bytes.
// - This plugin emits each listed path's bytes, unchanged, at the file above.
// - The Caddyfile rewrites a GET/HEAD for `/api/v2/<rest>` (trailing slashes
//   stripped, as the middleware does) to `{path}.json` and answers anything
//   else under `/api/v2/` with the middleware's 404 `application/problem+json`.
//
// Route segments may only contain lowercase letters, digits and '-', so
// appending `.json` can never collide with another route or escape `api/v2/`.
//
// Fail closed: a missing or unreadable index, an empty route table, a route
// outside that shape, two routes on one file, a fixture outside the fixture
// root, or a fixture that is not JSON fails the build. A release never ships a
// partial API.

import { readFile } from "node:fs/promises";

import { API_PREFIX, readRouteTable, resolveFixtureFile } from "./v5-api-middleware.mjs";

const ROUTE_PATTERN = /^\/api\/v2\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** `dist`-relative file a public `/api/v2/*` route is bundled at. Throws for any other shape. */
export function bundleFileForRoute(route) {
  if (typeof route !== "string" || !route.startsWith(API_PREFIX) || !ROUTE_PATTERN.test(route)) {
    throw new Error(`slice API route ${JSON.stringify(route)} is not /api/v2/<lowercase-segments>`);
  }
  return `${route.slice(1)}.json`;
}

/**
 * Every route in the slice table with the `dist` file it is bundled at and the
 * fixture's bytes, sorted by route. Throws instead of returning a partial list.
 */
export async function collectSliceApiBundle() {
  const routes = await readRouteTable();
  if (routes === null) {
    throw new Error("slice API route table fixtures/v5/one-character-slice/api/index.json is missing or unreadable");
  }
  const entries = Object.entries(routes).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (entries.length === 0) throw new Error("slice API route table is empty");

  const files = new Set();
  const bundle = [];
  for (const [route, relativePath] of entries) {
    const fileName = bundleFileForRoute(route);
    if (files.has(fileName)) throw new Error(`two slice API routes map to ${fileName}`);
    files.add(fileName);

    const fixture = resolveFixtureFile(relativePath);
    if (fixture === null) throw new Error(`slice API route ${route} points outside the fixture root`);
    const source = await readFile(fixture, "utf8");
    try {
      JSON.parse(source);
    } catch (error) {
      throw new Error(`slice API route ${route}: fixture is not JSON (${error.message})`);
    }
    bundle.push({ route, fileName, source });
  }
  return bundle;
}

/** Vite plugin: during `vite build`, emit the slice API into `dist/api/v2/`. */
export function v5SliceApiBundle() {
  return {
    name: "panshi-v5-slice-api-bundle",
    apply: "build",
    async generateBundle() {
      for (const entry of await collectSliceApiBundle()) {
        this.emitFile({ type: "asset", fileName: entry.fileName, source: entry.source });
      }
    },
  };
}
