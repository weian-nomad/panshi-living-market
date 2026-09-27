// The dev/preview middleware decides which of the two documents a route path
// is served from. It must mirror `deploy/study/Caddyfile`: the bare origin is
// the V5 world, the sealed research-v4 study answers on `/study*` and
// `/research*`, and everything else stays unrouted so Vite answers 404 instead
// of dropping a stray path into whichever app owns `index.html`.
import { describe, expect, it } from "vitest";

import { resolveShellEntry } from "./v5-api-middleware.mjs";

const WORLD_SHELL = "/world.html";
const STUDY_SHELL = "/index.html";

const CHARACTER_ID = "1f0c2a5e-6a2d-4d1b-9a3f-0c9d2f5b7e41";

describe("resolveShellEntry", () => {
  it("serves the V5 world shell at the bare origin", () => {
    expect(resolveShellEntry("/")).toBe(WORLD_SHELL);
  });

  it("serves the V5 world shell on every slice route", () => {
    const worldPaths = [
      "/world",
      "/people",
      `/people/${CHARACTER_ID}`,
      `/people/${CHARACTER_ID}/journal`,
      `/people/${CHARACTER_ID}/archive`,
      `/people/${CHARACTER_ID}/archive/paper`,
      `/people/${CHARACTER_ID}/archive/relations`,
      `/people/${CHARACTER_ID}/archive/chart`,
      `/people/${CHARACTER_ID}/archive/traits`,
      `/people/${CHARACTER_ID}/archive/memories`,
      `/people/${CHARACTER_ID}/archive/life`,
    ];
    for (const pathname of worldPaths) {
      expect(resolveShellEntry(pathname)).toBe(WORLD_SHELL);
    }
  });

  it("serves the sealed study document on its own mount points", () => {
    const studyPaths = ["/study", "/study/P01", "/research"];
    for (const pathname of studyPaths) {
      expect(resolveShellEntry(pathname)).toBe(STUDY_SHELL);
    }
  });

  it("leaves an unknown path unrouted instead of picking an app for it", () => {
    const unknown = ["/journal", "/archive", "/worlds", "/studying", "/zzz-nope", "/api/v2/world"];
    for (const pathname of unknown) {
      expect(resolveShellEntry(pathname)).toBeNull();
    }
  });

  it("never rewrites a file request into a document", () => {
    const files = [
      "/study-sw.js",
      "/study-release.json",
      "/manifest.webmanifest",
      "/icons/panshi-world-192.png",
      "/world.html",
      "/index.html",
    ];
    for (const pathname of files) {
      expect(resolveShellEntry(pathname)).toBeNull();
    }
  });
});
