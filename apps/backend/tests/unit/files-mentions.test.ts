import { describe, expect, test } from "bun:test";
import { contentDisposition, extensionOf, fileTypeFor, sanitizeFileName } from "../../lib/fileTypes";
import { extractMentionIds, newMentionIds, stripMentionTokens } from "../../lib/mentions";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj");

describe("file types", () => {
  test("type comes from the extension and must match the bytes", () => {
    expect(fileTypeFor("screen.PNG")!.matches(PNG)).toBe(true);
    expect(fileTypeFor("screen.png")!.matches(Buffer.from("<html><script>alert(1)</script>"))).toBe(false);
    expect(fileTypeFor("report.pdf")!.matches(PDF)).toBe(true);
    expect(fileTypeFor("report.pdf")!.matches(PNG)).toBe(false);
    expect(fileTypeFor("notes.txt")!.matches(Buffer.from("hello\nworld"))).toBe(true);
    expect(fileTypeFor("notes.txt")!.matches(PNG)).toBe(false); // NUL bytes = binary
  });

  test("dangerous or unknown types are not allowed", () => {
    for (const name of ["logo.svg", "page.html", "run.exe", "script.js", "noextension", "archive.tar.gz"]) {
      expect(fileTypeFor(name)).toBeNull();
    }
  });

  test("only raster images render inline", () => {
    expect(fileTypeFor("a.jpg")!.inline).toBe(true);
    expect(fileTypeFor("a.pdf")!.inline).toBe(false);
    expect(fileTypeFor("a.csv")!.inline).toBe(false);
  });

  test("file names are stripped of paths, control characters and quotes", () => {
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\Users\\me\\invoice.pdf")).toBe("invoice.pdf");
    expect(sanitizeFileName('bad"name\u0000\r\n.txt')).toBe("badname.txt");
    expect(sanitizeFileName("...hidden.txt")).toBe("hidden.txt");
    expect(sanitizeFileName("")).toBe("file");
    const long = sanitizeFileName(`${"x".repeat(400)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(180);
    expect(extensionOf(long)).toBe("pdf");
  });

  test("Content-Disposition is header-safe and keeps unicode names", () => {
    const header = contentDisposition("attachment", 'Résumé "final".pdf');
    expect(header).toStartWith('attachment; filename="R_sum_ _final_.pdf"');
    expect(header).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf");
    expect(header).not.toMatch(/[\r\n]/);
  });
});

describe("mentions", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";

  test("extracts unique ids from tokens and ignores look-alikes", () => {
    const text = `Hi @[Ada Lovelace](${a}) and @[Bob](${b}), cc @[Ada](${a.toUpperCase()}). Not a mention: @Ada, [x](${a}), @[x](not-a-uuid)`;
    expect(extractMentionIds(text)).toEqual([a, b]);
    expect(extractMentionIds(null)).toEqual([]);
  });

  test("caps the number of mentions", () => {
    const many = Array.from({ length: 30 }, (_, i) => `@[U${i}](${`${i}`.padStart(8, "0")}-1111-4111-8111-111111111111)`).join(" ");
    expect(extractMentionIds(many)).toHaveLength(20);
  });

  test("edits only report newly added mentions", () => {
    expect(newMentionIds(`@[Ada](${a})`, `@[Ada](${a}) @[Bob](${b})`)).toEqual([b]);
    expect(newMentionIds(null, `@[Ada](${a})`)).toEqual([a]);
    expect(newMentionIds(`@[Ada](${a})`, "removed")).toEqual([]);
  });

  test("renders tokens as plain @names", () => {
    expect(stripMentionTokens(`ping @[Ada Lovelace](${a})!`)).toBe("ping @Ada Lovelace!");
  });
});
