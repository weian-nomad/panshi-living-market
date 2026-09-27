import { describe, expect, it } from "vitest";

import {
  archiveSectionKeyOf,
  archiveSectionRoute,
  characterIdOf,
  parsePath,
  routeLabel,
  routeToPath,
  type Route,
} from "./router";

const CHARACTER_ID = "1f0c2a5e-6a2d-4d1b-9a3f-0c9d2f5b7e41";

const roundTrippable: readonly { path: string; route: Route }[] = [
  { path: "/world", route: { kind: "world" } },
  { path: `/people/${CHARACTER_ID}`, route: { kind: "closeUp", characterId: CHARACTER_ID } },
  {
    path: `/people/${CHARACTER_ID}/journal`,
    route: { kind: "journal", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive`,
    route: { kind: "archive", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive/paper`,
    route: { kind: "archivePaper", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive/relations`,
    route: { kind: "archiveRelations", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive/chart`,
    route: { kind: "archiveChart", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive/traits`,
    route: { kind: "archiveTraits", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive/memories`,
    route: { kind: "archiveMemories", characterId: CHARACTER_ID },
  },
  {
    path: `/people/${CHARACTER_ID}/archive/life`,
    route: { kind: "archiveLife", characterId: CHARACTER_ID },
  },
];

describe("v5 slice router", () => {
  it("parses every public slice path", () => {
    for (const { path, route } of roundTrippable) {
      expect(parsePath(path)).toEqual(route);
    }
  });

  it("round-trips path -> route -> path", () => {
    for (const { path } of roundTrippable) {
      expect(routeToPath(parsePath(path))).toBe(path);
    }
  });

  it("round-trips route -> path -> route", () => {
    for (const { route } of roundTrippable) {
      expect(parsePath(routeToPath(route))).toEqual(route);
    }
  });

  it("opens the public world at the bare origin", () => {
    expect(parsePath("/")).toEqual({ kind: "world" });
    expect(parsePath("/?from=share")).toEqual({ kind: "world" });
    // `/world` stays the canonical address the shell pushes into history.
    expect(routeToPath(parsePath("/"))).toBe("/world");
  });

  it("leaves the sealed research-v4 study outside the V5 router", () => {
    const studyPaths = [
      "/study",
      "/study/",
      "/study/P01",
      "/study/P01?visit=1",
      "/research",
      "/index.html",
    ];
    for (const path of studyPaths) {
      expect(parsePath(path)).toEqual({ kind: "notFound" });
    }
  });

  it("tolerates trailing slashes and query strings without inventing a route", () => {
    expect(parsePath("/world/")).toEqual({ kind: "world" });
    expect(parsePath("/world?from=shell")).toEqual({ kind: "world" });
    expect(parsePath(`/people/${CHARACTER_ID}/journal/`)).toEqual({
      kind: "journal",
      characterId: CHARACTER_ID,
    });
  });

  it("decodes percent-encoded character ids", () => {
    expect(parsePath("/people/lu%20yanzhi")).toEqual({
      kind: "closeUp",
      characterId: "lu yanzhi",
    });
    expect(routeToPath({ kind: "closeUp", characterId: "lu yanzhi" })).toBe("/people/lu%20yanzhi");
  });

  it("returns notFound for unknown paths instead of guessing", () => {
    const unknown = [
      "/index.html",
      "/journal",
      "/worlds",
      "/people",
      "/people/",
      `/people/${CHARACTER_ID}/journals`,
      `/people/${CHARACTER_ID}/archive/relation`,
      `/people/${CHARACTER_ID}/archive/toString`,
      `/people/${CHARACTER_ID}/archive/paper/lots`,
      `/people/${CHARACTER_ID}/archive/life/extra`,
      "/api/v2/world",
      "/people/%E0%A4%A",
    ];
    for (const path of unknown) {
      expect(parsePath(path)).toEqual({ kind: "notFound" });
    }
  });

  it("exposes the character id only for character-scoped routes", () => {
    expect(characterIdOf({ kind: "world" })).toBeNull();
    expect(characterIdOf({ kind: "notFound" })).toBeNull();
    expect(characterIdOf({ kind: "archivePaper", characterId: CHARACTER_ID })).toBe(CHARACTER_ID);
    expect(characterIdOf({ kind: "archiveLife", characterId: CHARACTER_ID })).toBe(CHARACTER_ID);
  });

  it("maps every archive section key to its own route and back", () => {
    const keys = ["paper", "relations", "chart", "traits", "memories", "life"] as const;
    const labels = new Set<string>();
    for (const key of keys) {
      const route = archiveSectionRoute(key, CHARACTER_ID);
      expect(archiveSectionKeyOf(route)).toBe(key);
      expect(routeToPath(route)).toBe(`/people/${CHARACTER_ID}/archive/${key}`);
      labels.add(routeLabel(route));
    }
    // 每一節都有自己的頁名，不共用一個模糊標題。
    expect(labels.size).toBe(keys.length);
    expect(archiveSectionKeyOf({ kind: "archive", characterId: CHARACTER_ID })).toBeNull();
    expect(archiveSectionKeyOf({ kind: "journal", characterId: CHARACTER_ID })).toBeNull();
  });
});
