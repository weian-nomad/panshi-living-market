import { describe, expect, it } from "vitest";

import { type Placement, seatOrder, swapPlacement } from "./placement";

const placement: Placement = {
  gatekeeper: { characterId: "c1", dossierId: "d1" },
  "core-a": { characterId: "c2", dossierId: "d2" },
  "core-b": { characterId: "c3", dossierId: "d3" },
  flank: { characterId: "c4", dossierId: "d4" },
  explore: { characterId: "c5", dossierId: "d5" },
};

describe("swapPlacement", () => {
  it("moves a character by swapping with the occupied seat", () => {
    const next = swapPlacement(placement, "character", "c1", "core-a");
    expect(next.gatekeeper.characterId).toBe("c2");
    expect(next["core-a"].characterId).toBe("c1");
    expect(next.gatekeeper.dossierId).toBe("d1");
  });

  it("preserves five-way dossier uniqueness", () => {
    const next = swapPlacement(placement, "dossier", "d5", "core-b");
    const dossierIds = seatOrder.map((seatId) => next[seatId].dossierId);
    expect(new Set(dossierIds).size).toBe(5);
    expect(next["core-b"].dossierId).toBe("d5");
  });

  it("returns the same draft when the item is already in the target seat", () => {
    expect(swapPlacement(placement, "character", "c1", "gatekeeper")).toBe(placement);
  });
});
