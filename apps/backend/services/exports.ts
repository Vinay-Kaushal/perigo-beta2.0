import { env } from "../lib/env";
import { HttpError } from "../lib/http";

/** Refuse rather than silently truncate: a partial export looks complete to whoever opens it. */
export function assertExportSize(rows: number) {
  const max = env().EXPORT_MAX_ROWS;
  if (rows > max) {
    throw new HttpError(422, `Exports are limited to ${max.toLocaleString("en")} rows. Narrow the date range or filters.`, "EXPORT_TOO_LARGE", { max });
  }
}

/**
 * Loads rows for a fixed, already-ordered id list in chunks. Snapshotting ids up front means
 * tickets edited mid-export (the default sort is `updatedAt`) can't be skipped or repeated.
 */
export async function* inIdBatches<T extends { id: string }>(ids: string[], load: (ids: string[]) => Promise<T[]>, size = 500) {
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const byId = new Map((await load(chunk)).map((row) => [row.id, row]));
    yield chunk.flatMap((id) => byId.get(id) ?? []);
  }
}

export async function* mapBatches<T>(batches: AsyncIterable<T[]>, toRow: (item: T) => unknown[]) {
  for await (const batch of batches) yield batch.map(toRow);
}

/** The query that produced an export, for the audit log (strings only, bounded). */
export function exportFilters(query: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, v]) => typeof v === "string" && v.length > 0)
      .slice(0, 20)
      .map(([k, v]) => [k.slice(0, 40), (v as string).slice(0, 200)])
  );
}
