export type ItemKind = "character" | "dossier";
export type SeatId = "gatekeeper" | "core-a" | "core-b" | "flank" | "explore";
export type Placement = Record<SeatId, { characterId: string; dossierId: string }>;

export const seatOrder: SeatId[] = ["gatekeeper", "core-a", "core-b", "flank", "explore"];

/**
 * Applies one placement as a swap so the five characters and five dossiers
 * remain bijective in the local draft. Canonical validation still happens on
 * the server.
 */
export function swapPlacement(
  current: Placement,
  kind: ItemKind,
  itemId: string,
  targetSeatId: SeatId,
): Placement {
  const field = kind === "character" ? "characterId" : "dossierId";
  const sourceSeatId = seatOrder.find((seatId) => current[seatId][field] === itemId);
  if (!sourceSeatId || sourceSeatId === targetSeatId) return current;

  return {
    ...current,
    [sourceSeatId]: {
      ...current[sourceSeatId],
      [field]: current[targetSeatId][field],
    },
    [targetSeatId]: {
      ...current[targetSeatId],
      [field]: itemId,
    },
  };
}
