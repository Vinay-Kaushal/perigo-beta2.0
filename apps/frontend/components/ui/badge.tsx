import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium", {
  variants: {
    tone: {
      neutral: "bg-surface-raised text-ink-muted border border-border",
      urgent: "bg-urgent/10 text-urgent",
      high: "bg-high/10 text-high",
      medium: "bg-medium/10 text-medium",
      low: "bg-low/10 text-ink-muted",
      success: "bg-success/10 text-success",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
