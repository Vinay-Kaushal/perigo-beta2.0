import { describe, expect, test } from "bun:test";
import { csvCell, csvRow, safeFilename } from "../../lib/csv";

describe("csvCell", () => {
  test("RFC 4180 quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded ")).toBe('" padded "');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("Yes");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(new Date("2026-09-16T10:00:00Z"))).toBe("2026-09-16T10:00:00.000Z");
  });

  test("neutralises spreadsheet formulas in text", () => {
    expect(csvCell('=HYPERLINK("https://evil.example","Click")')).toBe(`"'=HYPERLINK(""https://evil.example"",""Click"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell("\r=1")).toBe(`"'\r=1"`);
    expect(csvCell("\n=1")).toBe(`"'\n=1"`);
    for (const wide of ["＝1+1", "＋1", "－1", "＠SUM(A1)"]) expect(csvCell(wide)).toBe(`'${wide}`);
    expect(csvCell("a=b")).toBe("a=b");
  });

  test("rows end with CRLF", () => {
    expect(csvRow(["Key", "Title, with comma", 3])).toBe('Key,"Title, with comma",3\r\n');
  });
});

describe("safeFilename", () => {
  test("keeps headers safe", () => {
    expect(safeFilename("acme-tickets-2026-09-01_2026-09-30.csv")).toBe("acme-tickets-2026-09-01_2026-09-30.csv");
    expect(safeFilename('evil"\r\nSet-Cookie: x=1.csv')).toBe("evil-Set-Cookie-x-1.csv");
    expect(safeFilename("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFilename("")).toBe("export");
  });
});
