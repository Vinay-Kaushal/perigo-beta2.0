"use client";

import * as React from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownTrigger = Menu.Trigger;

export function DropdownContent({ className, align = "end", ...props }: Menu.DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-[200px] rounded-md border border-border bg-surface p-1 shadow-pop data-[state=open]:animate-scale-in", className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownItem({ className, destructive, ...props }: Menu.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] text-ink outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50 [&_svg]:text-ink-faint",
        destructive && "text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger",
        className
      )}
      {...props}
    />
  );
}

export function DropdownCheckItem({ checked, children, ...props }: Menu.DropdownMenuItemProps & { checked: boolean }) {
  return (
    <DropdownItem {...props}>
      <span className="flex w-4 justify-center">{checked && <Check size={14} strokeWidth={2.5} className="!text-ink" />}</span>
      {children}
    </DropdownItem>
  );
}

export function DropdownLabel({ className, ...props }: Menu.DropdownMenuLabelProps) {
  return <Menu.Label className={cn("px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wide text-ink-faint", className)} {...props} />;
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}
