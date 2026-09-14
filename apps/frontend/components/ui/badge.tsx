import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium", {
  variants: {
    tone: {
      neutral: "border-border bg-surface-muted text-ink-muted",
      accent: "border-accent/20 bg-accent-soft text-accent-ink",
      success: "border-success/20 bg-success/10 text-success",
      warning: "border-warning/25 bg-warning/10 text-warning",
      danger: "border-danger/20 bg-danger/10 text-danger",
      info: "border-info/20 bg-info/10 text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full bg-current", className)} />;
}
