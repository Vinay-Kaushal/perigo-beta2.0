/**
 * Gap-based positioning: instead of re-numbering every row when something
 * moves (expensive + noisy for realtime, since it would broadcast N
 * "task updated" events for one drag), new positions are computed as the
 * midpoint between the two neighbours the item was dropped between.
 *
 * New rows are spaced GAP apart (1000, 2000, 3000...) so there's always
 * room to slot something in between without touching siblings.
 */
export const POSITION_GAP = 1000;

export function nextPosition(lastPosition: number | null): number {
  return (lastPosition ?? 0) + POSITION_GAP;
}

/**
 * Returns the position to give an item dropped between `before` and `after`
 * (either can be null/undefined if dropping at the start/end of the list).
 * Since `position` is an Int in the schema, this can eventually run out of
 * integer room between two adjacent items after many reorders in the same
 * spot — see the reindex() note below.
 */
export function betweenPosition(
  before: number | null | undefined,
  after: number | null | undefined
): number {
  if (before == null && after == null) return POSITION_GAP;
  if (before == null) return after! / 2;
  if (after == null) return before + POSITION_GAP;
  return before + (after - before) / 2;
}

/** True once two adjacent positions are too close to safely split again (Int floor). */
export function needsRebalance(before: number, after: number): boolean {
  return Math.abs(after - before) < 1;
}
