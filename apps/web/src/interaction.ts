// Reused as a V5 presentation primitive per docs/v5/system-design.md §18.2
// ("world-space hit testing... kept as follow-camera/handoff primitive").
// Not legacy: this file is expected to keep being used by V5 world/follow
// surfaces, extended with pointer/keyboard/screen-reader tests.

export type WorldPoint = {
  x: number;
  y: number;
};

export type WorldHitTarget = WorldPoint & {
  id: string;
  radiusX: number;
  radiusY: number;
  priority?: number;
};

export function hitTestWorldPoint(
  point: WorldPoint,
  targets: readonly WorldHitTarget[],
): string | null {
  let best: { id: string; score: number; priority: number } | null = null;

  for (const target of targets) {
    if (target.radiusX <= 0 || target.radiusY <= 0) continue;
    const normalizedX = (point.x - target.x) / target.radiusX;
    const normalizedY = (point.y - target.y) / target.radiusY;
    const score = normalizedX * normalizedX + normalizedY * normalizedY;
    if (score > 1) continue;

    const priority = target.priority ?? 0;
    if (!best || priority > best.priority || (priority === best.priority && score < best.score)) {
      best = { id: target.id, score, priority };
    }
  }

  return best?.id ?? null;
}
