import { describe, expect, test } from "bun:test";
import { activeMentionQuery, fromTokens, matchCandidates, parseRichText, toTokens } from "./mentions";

const ada = { id: "11111111-1111-4111-8111-111111111111", name: "Ada Lovelace" };
const adaShort = { id: "33333333-3333-4333-8333-333333333333", name: "Ada" };
const bob = { id: "22222222-2222-4222-8222-222222222222", name: "Bob" };

describe("toTokens / fromTokens", () => {
  test("converts picked mentions still present in the text", () => {
    expect(toTokens("Hi @Ada Lovelace and @Bob!", [ada, bob])).toBe(`Hi @[Ada Lovelace](${ada.id}) and @[Bob](${bob.id})!`);
    // Bob was picked but then deleted from the text: nothing to convert.
    expect(toTokens("Hi @Ada Lovelace", [ada, bob])).toBe(`Hi @[Ada Lovelace](${ada.id})`);
  });

  test("longest names win and partial words aren't matched", () => {
    expect(toTokens("@Ada Lovelace vs @Ada", [adaShort, ada])).toBe(`@[Ada Lovelace](${ada.id}) vs @[Ada](${adaShort.id})`);
    expect(toTokens("email@Bob.com and @Bobby", [bob])).toBe("email@Bob.com and @Bobby");
  });

  test("names with regex characters are handled", () => {
    const odd = { id: bob.id, name: "J.R. (Bob)" };
    expect(toTokens("cc @J.R. (Bob)", [odd])).toBe(`cc @[J.R. (Bob)](${bob.id})`);
  });

  test("round-trips for editing", () => {
    const stored = `Ping @[Ada Lovelace](${ada.id}) re: @[Bob](${bob.id})`;
    const { text, mentions } = fromTokens(stored);
    expect(text).toBe("Ping @Ada Lovelace re: @Bob");
    expect(toTokens(text, mentions)).toBe(stored);
  });
});

describe("parseRichText", () => {
  test("splits mentions, links and text without interpreting HTML", () => {
    const segments = parseRichText(`<b>hi</b> @[Bob](${bob.id}) see https://example.com/a?b=1. done`);
    expect(segments).toEqual([
      { type: "text", value: "<b>hi</b> " },
      { type: "mention", name: "Bob", id: bob.id },
      { type: "text", value: " see " },
      { type: "link", href: "https://example.com/a?b=1." },
      { type: "text", value: " done" },
    ]);
  });

  test("javascript: and other schemes are never links", () => {
    expect(parseRichText("javascript:alert(1) data:text/html,x").every((s) => s.type === "text")).toBe(true);
  });
});

describe("activeMentionQuery", () => {
  test("detects @query at the caret only at word starts", () => {
    expect(activeMentionQuery("hello @ad", 9)).toEqual({ query: "ad", start: 6 });
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("mail@ad", 7)).toBeNull();
    expect(activeMentionQuery("hello @ada done", 15)).toBeNull();
  });
});

describe("matchCandidates", () => {
  const people = [
    { id: "1", name: "Priya Shah", email: "owner@acme.test" },
    { id: "2", name: "Marcus Chen", email: "admin@acme.test" },
    { id: "3", name: "Sam Okafor", email: "sam@acme.test" },
    { id: "4", name: "Alex Rivera", email: "alex@acme.test" },
  ];
  const names = (q: string) => matchCandidates(people, q).map((p) => p.name);

  test("matches word starts, not arbitrary substrings", () => {
    expect(names("s")).toEqual(["Sam Okafor", "Priya Shah"]);
    expect(names("chen")).toEqual(["Marcus Chen"]);
    expect(names("rc")).toEqual([]);
  });

  test("falls back to email prefixes and ranks full-name starts first", () => {
    expect(names("admin")).toEqual(["Marcus Chen"]);
    expect(names("a")).toEqual(["Alex Rivera", "Marcus Chen"]);
  });

  test("empty query lists everyone up to the limit", () => {
    expect(matchCandidates(people, "", 2)).toHaveLength(2);
  });
});
