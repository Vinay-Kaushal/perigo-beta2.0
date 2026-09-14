"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { activeMentionQuery, matchCandidates, toTokens, type MentionCandidate } from "@/lib/mentions";
import { cn } from "@/lib/utils";

export interface MentionTextareaHandle {
  /** The current text with picked mentions converted to API tokens. */
  serialize: () => string;
  focus: () => void;
}

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  candidates: MentionCandidate[];
  /** Mentions already present in `value` (e.g. when editing existing text). */
  initialMentions?: MentionCandidate[];
}

/**
 * Textarea with @-autocomplete. Shows plain "@Name" while typing; picked people
 * are tracked so the text can be serialized to unambiguous id tokens.
 */
export const MentionTextarea = forwardRef<MentionTextareaHandle, Props>(function MentionTextarea(
  { value, onValueChange, candidates, initialMentions = [], onKeyDown, className, ...props },
  ref
) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [picked, setPicked] = useState<MentionCandidate[]>(initialMentions);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [index, setIndex] = useState(0);

  useImperativeHandle(ref, () => ({
    serialize: () => toTokens(value, picked),
    focus: () => textarea.current?.focus(),
  }));

  const matches = useMemo(() => (query ? matchCandidates(candidates, query.query) : []), [candidates, query]);

  function updateQuery(el: HTMLTextAreaElement) {
    const next = activeMentionQuery(el.value, el.selectionStart ?? el.value.length);
    setQuery(next);
    setIndex(0);
  }

  function pick(person: MentionCandidate) {
    const el = textarea.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${person.name} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    onValueChange(next);
    setPicked((p) => (p.some((x) => x.id === person.id) ? p : [...p, person]));
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  const open = query !== null && matches.length > 0;

  return (
    <div className="relative">
      <Textarea
        ref={textarea}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          updateQuery(e.target);
        }}
        onClick={(e) => updateQuery(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") return (e.preventDefault(), setIndex((i) => (i + 1) % matches.length));
            if (e.key === "ArrowUp") return (e.preventDefault(), setIndex((i) => (i - 1 + matches.length) % matches.length));
            if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pick(matches[index]!));
            if (e.key === "Escape") return (e.preventDefault(), setQuery(null));
          }
          onKeyDown?.(e);
        }}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? "mention-suggestions" : undefined}
        className={className}
        {...props}
      />
      {open && (
        <ul id="mention-suggestions" role="listbox" aria-label="Mention someone" className="absolute left-2 z-20 mt-1 w-64 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-pop">
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseDown={(e) => (e.preventDefault(), pick(m))}
                onMouseEnter={() => setIndex(i)}
                className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px]", i === index ? "bg-surface-hover text-ink" : "text-ink-muted")}
              >
                <Avatar name={m.name} src={m.avatarUrl} size={20} />
                <span className="flex-1 truncate">{m.name}</span>
                {m.email && <span className="truncate text-2xs text-ink-faint">{m.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
