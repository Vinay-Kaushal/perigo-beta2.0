/**
 * Mentions are stored inline as `@[Display Name](user-uuid)` — the editor
 * inserts them, so there's no ambiguity between people with the same name.
 * Display names inside the token are never trusted for anything but display.
 */
const MENTION_RE = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
const MAX_MENTIONS = 20;

export function extractMentionIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    ids.add(match[2]!.toLowerCase());
    if (ids.size >= MAX_MENTIONS) break;
  }
  return [...ids];
}

/** Mentions present in `after` that weren't in `before` — so edits only notify newly mentioned people. */
export function newMentionIds(before: string | null | undefined, after: string | null | undefined) {
  const old = new Set(extractMentionIds(before));
  return extractMentionIds(after).filter((id) => !old.has(id));
}

/** Plain-text rendering for notifications and emails: `@[Ada](id)` -> `@Ada`. */
export function stripMentionTokens(text: string) {
  return text.replace(MENTION_RE, (_m, name: string) => `@${name}`);
}
