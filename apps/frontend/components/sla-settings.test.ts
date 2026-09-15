import { describe, expect, test } from "bun:test";
import { timezoneOptions } from "./sla-settings";

describe("timezoneOptions", () => {
  test("replaces legacy ICU names with current IANA names", () => {
    const zones = timezoneOptions("UTC", ["Asia/Calcutta", "Europe/Kiev", "Europe/London", "Asia/Saigon"]);
    expect(zones).toContain("Asia/Kolkata");
    expect(zones).toContain("Europe/Kyiv");
    expect(zones).toContain("Asia/Ho_Chi_Minh");
    expect(zones).not.toContain("Asia/Calcutta");
  });

  test("UTC and the saved zone are always selectable, without duplicates", () => {
    const zones = timezoneOptions("America/Sao_Paulo", ["Europe/London", "UTC"]);
    expect(zones.slice(0, 2)).toEqual(["UTC", "America/Sao_Paulo"]);
    expect(zones.filter((z) => z === "UTC")).toHaveLength(1);
  });

  test("falls back to a short list when the browser can't enumerate zones", () => {
    expect(timezoneOptions("UTC", [])).toContain("Asia/Kolkata");
  });
});
