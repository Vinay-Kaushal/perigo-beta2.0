/**
 * Mentions travel to the API as `@[Name](user-uuid)` tokens. In the editor the
 * user sees plain `@Name`; we remember which names were picked from the
 * autocomplete and convert them back to tokens on submit.
 */
export interface MentionCandidate {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
}

const TOKEN_RE = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Editor text + picked mentions -> API text with tokens. Only mentions still present in the text are converted. */
export function toTokens(text: string, picked: MentionCandidate[]): string {
  // Longest names first so "@Ada Lovelace" wins over "@Ada".
  const unique = [...new Map(picked.map((p) => [p.id, p])).values()].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const person of unique) {
    const re = new RegExp(`(^|[^\\w@\\]])@${escapeRegExp(person.name)}(?![\\w])`, "g");
    out = out.replace(re, (_m, lead: string) => `${lead}@[${person.name}](${person.id})`);
  }
  return out;
}

/** API text with tokens -> editor text + the mentions it contains (for editing existing content). */
export function fromTokens(text: string): { text: string; mentions: MentionCandidate[] } {
  const mentions = new Map<string, MentionCandidate>();
  const plain = text.replace(TOKEN_RE, (_m, name: string, id: string) => {
    mentions.set(id, { id, name });
    return `@${name}`;
  });
  return { text: plain, mentions: [...mentions.values()] };
}

export type RichSegment = { type: "text"; value: string } | { type: "mention"; name: string; id: string } | { type: "link"; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/** Splits stored text into text, mention and link segments for safe rendering (no HTML is ever interpreted). */
export function parseRichText(text: string): RichSegment[] {
  const segments: RichSegment[] = [];
  const pushText = (value: string) => {
    let last = 0;
    for (const match of value.matchAll(URL_RE)) {
      if (match.index! > last) segments.push({ type: "text", value: value.slice(last, match.index) });
      segments.push({ type: "link", href: match[0] });
      last = match.index! + match[0].length;
    }
    if (last < value.length) segments.push({ type: "text", value: value.slice(last) });
  };
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    if (match.index! > last) pushText(text.slice(last, match.index));
    segments.push({ type: "mention", name: match[1]!, id: match[2]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) pushText(text.slice(last));
  return segments;
}

/** The `@query` being typed at the caret, if any. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!match) return null;
  return { query: match[2]!, start: caret - match[2]!.length - 1 };
}

/**
 * Suggestions for an @query: names whose words start with the query (so "@lov"
 * finds "Ada Lovelace") or emails that start with it. Word-start matches rank first.
 */
export function matchCandidates(candidates: MentionCandidate[], query: string, limit = 6): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates.slice(0, limit);
  const scored = candidates
    .map((c) => {
      const name = c.name.toLowerCase();
      const score = name.startsWith(q) ? 0 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : c.email?.toLowerCase().startsWith(q) ? 2 : -1;
      return { c, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map((x) => x.c);
}
