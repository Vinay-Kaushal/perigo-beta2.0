import { describe, expect, test } from "bun:test";
import { POSITION_GAP, betweenPosition, nextPosition } from "../../utils/position";

describe("nextPosition", () => {
  test("starts at one gap and appends a gap after the last item", () => {
    expect(nextPosition(null)).toBe(POSITION_GAP);
    expect(nextPosition(undefined)).toBe(POSITION_GAP);
    expect(nextPosition(3000)).toBe(4000);
  });
});

describe("betweenPosition", () => {
  test("empty list", () => {
    expect(betweenPosition(null, null)).toBe(POSITION_GAP);
  });

  test("dropping at the end", () => {
    expect(betweenPosition(2000, null)).toBe(3000);
  });

  test("dropping at the start halves the first position", () => {
    expect(betweenPosition(null, 1000)).toBe(500);
  });

  test("midpoint between neighbours", () => {
    expect(betweenPosition(1000, 2000)).toBe(1500);
  });

  test("always returns integers (the column is an Int)", () => {
    expect(betweenPosition(1000, 1003)).toBe(1001);
    expect(betweenPosition(null, 1001)).toBe(500);
    for (let i = 0; i < 50; i++) {
      const a = Math.floor(Math.random() * 10_000);
      const b = a + 2 + Math.floor(Math.random() * 10_000);
      const p = betweenPosition(a, b)!;
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThan(a);
      expect(p).toBeLessThan(b);
    }
  });

  test("signals a rebalance when there's no integer room", () => {
    expect(betweenPosition(1000, 1001)).toBeNull();
    expect(betweenPosition(1000, 1000)).toBeNull();
    expect(betweenPosition(null, 1)).toBeNull();
  });
});
