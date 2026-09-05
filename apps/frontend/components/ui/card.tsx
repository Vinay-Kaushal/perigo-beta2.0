import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-sm transition-shadow duration-150",
        interactive && "hover:shadow-md hover:border-border-hover cursor-pointer",
        className
      )}
      {...props}
    />
  );
}
