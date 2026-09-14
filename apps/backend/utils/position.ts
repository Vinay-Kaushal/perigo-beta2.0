/**
 * Gap-based positioning: new positions are the midpoint between the two
 * neighbours an item is dropped between, so a drag touches one row instead
 * of renumbering the whole column. Rows are spaced POSITION_GAP apart.
 *
 * `position` is an Int column, so midpoints are floored and a null return
 * means "no integer room left" — the caller must rebalance the column.
 */
export const POSITION_GAP = 1000;

export function nextPosition(lastPosition: number | null | undefined): number {
  return (lastPosition ?? 0) + POSITION_GAP;
}

export function betweenPosition(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null && after == null) return POSITION_GAP;
  if (before == null) {
    const pos = Math.floor(after! / 2);
    return pos < after! && pos > 0 ? pos : null;
  }
  if (after == null) return before + POSITION_GAP;
  if (after - before < 2) return null;
  return before + Math.floor((after - before) / 2);
}
