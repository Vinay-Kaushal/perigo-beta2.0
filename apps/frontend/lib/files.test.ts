import { describe, expect, test } from "bun:test";
import { formatBytes, validateFile } from "./files";

describe("validateFile", () => {
  test("mirrors the API allowlist and size cap", () => {
    expect(validateFile({ name: "shot.PNG", size: 100 })).toBeNull();
    expect(validateFile({ name: "logo.svg", size: 100 })).toContain("isn't allowed");
    expect(validateFile({ name: "noext", size: 100 })).toContain("isn't allowed");
    expect(validateFile({ name: "a.txt", size: 0 })).toContain("empty");
    expect(validateFile({ name: "a.pdf", size: 10 * 1024 * 1024 + 1 })).toContain("larger than 10 MB");
  });

  test("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(50 * 1024)).toBe("50 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
