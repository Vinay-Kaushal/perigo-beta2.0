import Link from "next/link";
import { cn } from "@/lib/utils";

/** A single headline number — no plot, so no hover layer. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ElementType;
  tone?: "default" | "danger" | "warning" | "success";
  href?: string;
}) {
  const body = (
    <div className={cn("group h-full rounded-lg border border-border bg-surface p-4 shadow-card transition-colors", href && "hover:border-border-strong")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        {Icon && (
          <Icon
            size={16}
            className={cn(
              "text-ink-faint",
              tone === "danger" && "text-danger",
              tone === "warning" && "text-warning",
              tone === "success" && "text-success"
            )}
          />
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}
