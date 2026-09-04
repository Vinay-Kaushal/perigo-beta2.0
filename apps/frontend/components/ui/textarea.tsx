import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint",
        "focus-visible:border-accent resize-none",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
