import type { Response } from "express";

/**
 * RFC 4180 CSV with protection against formula injection: spreadsheet apps
 * execute cells starting with = + - @ (their full-width forms, and tab/CR/LF), so a ticket titled
 * `=HYPERLINK("https://evil", "Click")` would become a live formula in
 * whoever opens the export. Such strings are prefixed with an apostrophe,
 * which spreadsheets treat as "this is text". Numbers are written as-is.
 */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;

/** Letters, digits, dot, dash and underscore only — safe inside Content-Disposition. */
export function safeFilename(name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (cleaned || "export").slice(0, 120);
}

/** Resolves when the socket can take more, or is gone — a bare `once(res, "drain")` hangs forever on disconnect. */
function writable(res: Response) {
  return new Promise<void>((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}

/**
 * Streams rows to the client as they're read, honouring backpressure, and
 * stops reading when the client goes away. Starts with a UTF-8 BOM so Excel
 * shows non-ASCII names correctly.
 */
export async function streamCsv(res: Response, opts: { filename: string; header: string[]; batches: AsyncIterable<unknown[][]> }) {
  // Watch `res`: on Node, `req` also emits "close" once its body has been read, not only on disconnect.
  let aborted = false;
  const onClose = () => (aborted = !res.writableFinished);
  res.on("close", onClose);

  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(opts.filename)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");

  let rows = 0;
  try {
    if (!res.write(`\uFEFF${csvRow(opts.header)}`)) await writable(res);
    for await (const batch of opts.batches) {
      if (aborted) break;
      rows += batch.length;
      if (!res.write(batch.map(csvRow).join(""))) await writable(res);
    }
    if (!aborted) res.end();
  } catch (err) {
    // Headers are gone; the only honest signal left is a truncated, reset response.
    res.destroy(err instanceof Error ? err : new Error("CSV export failed"));
    throw err;
  } finally {
    res.off("close", onClose);
  }
  return { rows, aborted };
}
