import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full rounded border border-border bg-surface px-2.5 text-sm text-ink",
        "focus-visible:border-accent",
        className
      )}
      {...props}
    />
  )
);
Select.displayName = "Select";
