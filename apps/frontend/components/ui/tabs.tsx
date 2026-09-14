"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn("flex gap-1 overflow-x-auto border-b border-border", className)} {...props} />;
}

export function TabsTrigger({ className, count, children, ...props }: TabsPrimitive.TabsTriggerProps & { count?: number }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink",
        className
      )}
      {...props}
    >
      {children}
      {count !== undefined && count > 0 && <span className="rounded-full bg-surface-muted px-1.5 text-2xs text-ink-muted">{count}</span>}
    </TabsPrimitive.Trigger>
  );
}
