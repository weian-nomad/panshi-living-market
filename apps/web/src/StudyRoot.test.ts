import { describe, expect, it } from "vitest";

import { resolveStudyRoute } from "./studyRoutes";

describe("resolveStudyRoute", () => {
  it("opens the public world at the root URL", () => {
    expect(resolveStudyRoute(new URL("https://world.panshi.app/"))).toEqual({ kind: "standard" });
  });

  it("keeps participant research behind the study path", () => {
    expect(resolveStudyRoute(new URL("https://world.panshi.app/study/P07?visit=2"))).toEqual({
      kind: "participant",
      participantCode: "P07",
      visitOrdinal: 2,
    });
  });

  it("keeps the legacy participant query route compatible", () => {
    expect(resolveStudyRoute(new URL("https://world.panshi.app/?study=P07&visit=1"))).toEqual({
      kind: "participant",
      participantCode: "P07",
      visitOrdinal: 1,
    });
  });

  it("opens the researcher console only on its explicit route", () => {
    expect(resolveStudyRoute(new URL("https://world.panshi.app/research"))).toEqual({
      kind: "researcher",
    });
  });
});
