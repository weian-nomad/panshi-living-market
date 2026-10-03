// The slice API has one path rule in three places: the dev/preview middleware
// (./v5-api-middleware.mjs), the build bundle (./v5-slice-api-bundle.mjs) and the
// preview image's Caddyfile (deploy/preview/Caddyfile):
//
//   /api/v2/<rest>  ->  api/v2/<rest>.json   (GET/HEAD; trailing slashes stripped;
//                                              anything else: 404 problem+json)
//
// These tests hold the middleware and the bundle to the same bytes for every
// route, and the Caddyfile to the same rule. The Caddyfile itself only runs at
// deploy time (deploy/preview/smoke.sh exercises it end to end).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { v5ApiMiddleware } from "./v5-api-middleware.mjs";
import { bundleFileForRoute, collectSliceApiBundle } from "./v5-slice-api-bundle.mjs";

const REPO = new URL("../../../", import.meta.url);
const index = JSON.parse(readFileSync(new URL("fixtures/v5/one-character-slice/api/index.json", REPO), "utf8"));
const previewCaddyfile = readFileSync(new URL("deploy/preview/Caddyfile", REPO), "utf8");
const studyCaddyfile = readFileSync(new URL("deploy/study/Caddyfile", REPO), "utf8");

/** Runs one request through the real middleware and collects the response. */
function middlewareHandler() {
  let handler = null;
  v5ApiMiddleware().configureServer({ middlewares: { use: (fn) => (handler = fn) } });
  return (method, url) =>
    new Promise((resolve) => {
      const headers = {};
      const res = {
        statusCode: 200,
        setHeader: (name, value) => (headers[name.toLowerCase()] = value),
        end: (body) => resolve({ status: res.statusCode, headers, body: body ?? "" }),
      };
      handler({ method, url }, res, () => resolve({ status: "next", headers, body: "" }));
    });
}

describe("bundleFileForRoute", () => {
  it("maps a public route to api/v2/<rest>.json", () => {
    expect(bundleFileForRoute("/api/v2/world")).toBe("api/v2/world.json");
    expect(bundleFileForRoute("/api/v2/characters/96450815-0db8-f735-a139-5ba222da86b2/archive/paper")).toBe(
      "api/v2/characters/96450815-0db8-f735-a139-5ba222da86b2/archive/paper.json",
    );
  });

  it("rejects every route the Caddyfile rule could not serve unambiguously", () => {
    for (const route of [
      "/api/v2/",
      "/api/v2",
      "/api/v1/world",
      "/api/v2/World",
      "/api/v2/world.json",
      "/api/v2/a//b",
      "/api/v2/a/",
      "/api/v2/../secret",
      "/api/v2/a_b",
      "api/v2/world",
      42,
    ]) {
      expect(() => bundleFileForRoute(route), String(route)).toThrow();
    }
  });
});

describe("slice API bundle", () => {
  it("covers every route in the slice table, one file each, with the fixture's exact bytes", async () => {
    const bundle = await collectSliceApiBundle();
    expect(bundle.map((entry) => entry.route).sort()).toEqual(Object.keys(index.routes).sort());
    expect(new Set(bundle.map((entry) => entry.fileName)).size).toBe(bundle.length);
    for (const entry of bundle) {
      // The Caddyfile rule: the bundled file is the route with `.json` appended.
      expect(entry.fileName).toBe(`${entry.route.slice(1)}.json`);
      const fixture = readFileSync(new URL(`fixtures/v5/one-character-slice/api/${index.routes[entry.route]}`, REPO), "utf8");
      expect(entry.source).toBe(fixture);
    }
  });

  it("answers exactly what the dev middleware answers, route by route", async () => {
    const request = middlewareHandler();
    for (const entry of await collectSliceApiBundle()) {
      for (const url of [entry.route, `${entry.route}/`, `${entry.route}?cursor=x`]) {
        const response = await request("GET", url);
        expect(response.status, url).toBe(200);
        expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toBe(entry.source);
      }
      const head = await request("HEAD", entry.route);
      expect(head.status).toBe(200);
      expect(head.body).toBe("");
    }
  });

  it("answers anything else under /api/v2/ with the 404 problem the Caddyfile also returns", async () => {
    const request = middlewareHandler();
    const caddyProblem = caddyfileProblem();
    for (const [method, url] of [
      ["GET", "/api/v2/nope"],
      ["GET", "/api/v2/world.json"],
      ["POST", "/api/v2/world"],
      ["DELETE", "/api/v2/world"],
    ]) {
      const response = await request(method, url);
      expect(response.status, `${method} ${url}`).toBe(404);
      expect(response.headers["content-type"]).toBe("application/problem+json; charset=utf-8");
      expect(response.headers["cache-control"]).toBe("no-store");
      const problem = JSON.parse(response.body);
      const { traceId, ...rest } = problem;
      expect(typeof traceId).toBe("string");
      const { traceId: caddyTraceId, ...caddyRest } = caddyProblem;
      expect(caddyTraceId).toBe("{http.request.uuid}");
      expect(caddyRest).toEqual(rest);
    }
  });
});

/** The problem body the preview Caddyfile responds with (escaped braces unescaped). */
function caddyfileProblem() {
  const match = previewCaddyfile.match(/respond `(.+)` 404/);
  expect(match).not.toBeNull();
  return JSON.parse(match[1].replace(/\\\{/g, "{").replace(/\\\}/g, "}"));
}

describe("preview Caddyfile slice API block", () => {
  it("serves GET/HEAD of /api/v2/<rest> from <rest>.json with JSON and no-store, after stripping trailing slashes", () => {
    const apiBlock = previewCaddyfile.slice(previewCaddyfile.indexOf("@apiTrailingSlash"), previewCaddyfile.indexOf("@world"));
    expect(apiBlock).toContain("@apiTrailingSlash path_regexp apiTrailingSlash ^(/api/v2/.+?)/+$");
    expect(apiBlock).toContain("rewrite @apiTrailingSlash {re.apiTrailingSlash.1}");
    expect(apiBlock).toContain("@api path /api/v2/*");
    expect(apiBlock).toMatch(/@apiFile \{\s+method GET HEAD\s+file \{path\}\.json\s+\}/);
    expect(apiBlock).toMatch(/route @apiFile \{\s+rewrite \{path\}\.json\s+header Content-Type "application\/json; charset=utf-8"\s+file_server\s+\}/);
    expect(apiBlock).toContain('header Content-Type "application/problem+json; charset=utf-8"');
    // The block sits after the authentication and the no-store default.
    expect(previewCaddyfile.indexOf('header Cache-Control "no-store"')).toBeLessThan(previewCaddyfile.indexOf("basic_auth"));
    expect(previewCaddyfile.indexOf("basic_auth")).toBeLessThan(previewCaddyfile.indexOf("@api path"));
  });

  it("is not served by the public study image", () => {
    expect(studyCaddyfile).toMatch(/@sliceApi path \/api \/api\/\*\s+respond @sliceApi 404/);
    expect(studyCaddyfile.indexOf("respond @sliceApi 404")).toBeLessThan(studyCaddyfile.lastIndexOf("file_server"));
  });
});
