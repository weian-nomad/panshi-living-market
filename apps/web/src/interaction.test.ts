import { describe, expect, it } from "vitest";

import { hitTestWorldPoint, type WorldHitTarget } from "./interaction";

const targets: readonly WorldHitTarget[] = [
  { id: "resident-a", x: 20, y: 30, radiusX: 6, radiusY: 5 },
  { id: "resident-b", x: 31, y: 30, radiusX: 6, radiusY: 5 },
  { id: "announcement", x: 26, y: 28, radiusX: 12, radiusY: 5, priority: -1 },
];

describe("world-coordinate hit testing", () => {
  it("returns the nearest resident without depending on DOM order", () => {
    expect(hitTestWorldPoint({ x: 21, y: 30 }, targets)).toBe("resident-a");
    expect(hitTestWorldPoint({ x: 30, y: 30 }, [...targets].reverse())).toBe("resident-b");
  });

  it("uses priority only when hit regions overlap", () => {
    expect(hitTestWorldPoint({ x: 25, y: 30 }, targets)).toBe("resident-a");
  });

  it("returns null outside every target", () => {
    expect(hitTestWorldPoint({ x: 90, y: 90 }, targets)).toBeNull();
  });
});
