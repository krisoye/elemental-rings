/**
 * Small 2-D proximity helpers shared across the spatial scenes and world objects.
 *
 * These replace the inline Phaser distance-comparison proximity pattern that was
 * copy-pasted across BaseBiomeScene (anchorage auto-attune,
 * Sanctum-Stone activation, compass pull, NPC detection) and BlinkController.
 * Centralising the comparison keeps the radius semantics (inclusive `<=`) in one
 * place so every proximity check behaves identically.
 */

/** A bare 2-D point — anything with numeric `x`/`y` (a Player, an NPC, a center). */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * Whether `point` lies within (inclusive of) `radius` px of `target`. Uses the
 * squared distance internally so no `sqrt` is computed, matching the inclusive
 * `<=` semantics of the inline checks it replaces.
 */
export function withinRadius(point: Point2, target: Point2, radius: number): boolean {
  const dx = point.x - target.x;
  const dy = point.y - target.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * The object in `objects` nearest to `point` that is also within `radius`, or
 * `undefined` when none qualifies. Ties resolve to the first-seen candidate, so
 * the array's order is the tie-breaker (matching the existing "first within range
 * with the smallest distance wins" loops this replaces).
 */
export function nearest<T extends Point2>(
  point: Point2,
  objects: readonly T[],
  radius: number,
): T | undefined {
  let best: T | undefined;
  let bestDistSq = radius * radius;
  for (const obj of objects) {
    const dx = point.x - obj.x;
    const dy = point.y - obj.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq && (best === undefined || distSq < bestDistSq)) {
      best = obj;
      bestDistSq = distSq;
    }
  }
  return best;
}
