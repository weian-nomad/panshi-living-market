import { describe, expect, it } from "vitest";

import { formatSceneTime, getResidentLine, getSceneMoment, residents } from "./scene";

describe("historical scene timeline", () => {
  it("changes moments at the documented boundaries", () => {
    expect(getSceneMoment(19).id).toBe("open");
    expect(getSceneMoment(20).id).toBe("notice");
    expect(getSceneMoment(419).id).toBe("cross-talk");
    expect(getSceneMoment(420).id).toBe("position");
    expect(getSceneMoment(900).id).toBe("after");
  });

  it("keeps the historical clock inside the ten minute prototype", () => {
    expect(formatSceneTime(-10)).toBe("09:00:00");
    expect(formatSceneTime(71)).toBe("09:01:11");
    expect(formatSceneTime(900)).toBe("09:09:59");
  });

  it("changes a resident's observable thought fragment over time", () => {
    const resident = residents[0];
    expect(resident).toBeDefined();
    if (!resident) return;

    expect(getResidentLine(resident, 10)).toBe(resident.lines[0]);
    expect(getResidentLine(resident, 300)).toBe(resident.lines[1]);
    expect(getResidentLine(resident, 500)).toBe(resident.lines[2]);
  });

  it("keeps all resident identifiers unique", () => {
    expect(new Set(residents.map((resident) => resident.id)).size).toBe(residents.length);
  });
});
