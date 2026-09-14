import { parseRichText } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/**
 * Renders user-written text: mentions as chips, http(s) URLs as links, everything
 * else as plain text nodes. No HTML from users is ever interpreted.
 */
export function RichText({ text, className, currentUserId }: { text: string; className?: string; currentUserId?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {parseRichText(text).map((seg, i) => {
        if (seg.type === "mention") {
          return (
            <span
              key={i}
              className={cn(
                "rounded px-1 font-medium",
                seg.id === currentUserId ? "bg-warning/15 text-ink" : "bg-accent-soft text-accent-ink"
              )}
            >
              @{seg.name}
            </span>
          );
        }
        if (seg.type === "link") {
          return (
            <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-ink underline underline-offset-2 hover:no-underline">
              {seg.href}
            </a>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </p>
  );
}
