import { describe, expect, test } from "bun:test";
import { HttpError } from "../../lib/http";
import { assertExportSize, exportFilters, inIdBatches, mapBatches } from "../../services/exports";

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe("inIdBatches", () => {
  test("keeps the snapshot's order, chunks by size, and drops rows deleted meanwhile", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const loads: string[][] = [];
    const batches = await collect(
      inIdBatches(
        ids,
        async (chunk) => {
          loads.push(chunk);
          // The database returns rows in its own order and without "d".
          return chunk.filter((id) => id !== "d").reverse().map((id) => ({ id }));
        },
        2
      )
    );
    expect(loads).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(batches.map((b) => b.map((r) => r.id))).toEqual([["a", "b"], ["c"], ["e"]]);
  });

  test("no ids, no queries", async () => {
    let called = false;
    expect(await collect(inIdBatches([], async () => ((called = true), [])))).toEqual([]);
    expect(called).toBe(false);
  });
});

test("mapBatches maps each row", async () => {
  async function* src() {
    yield [1, 2];
    yield [3];
  }
  expect(await collect(mapBatches(src(), (n) => [n * 10]))).toEqual([[[10], [20]], [[30]]]);
});

test("assertExportSize refuses beyond the cap instead of truncating", () => {
  expect(() => assertExportSize(1200)).not.toThrow(); // EXPORT_MAX_ROWS in tests/setup.ts
  try {
    assertExportSize(1201);
    throw new Error("expected to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
    expect((err as HttpError).code).toBe("EXPORT_TOO_LARGE");
  }
});

test("exportFilters keeps bounded strings only", () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "v"]));
  expect(exportFilters({ status: "open", empty: "", arr: ["a", "b"], obj: { $ne: 1 }, long: "x".repeat(500), ["y".repeat(80)]: "z" })).toEqual({
    status: "open",
    long: "x".repeat(200),
    ["y".repeat(40)]: "z",
  });
  expect(Object.keys(exportFilters(many))).toHaveLength(20);
});
