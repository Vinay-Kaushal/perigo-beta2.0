"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function OrgTabs({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Dashboard", href: `/orgs/${orgId}/dashboard` },
    { label: "Boards", href: `/orgs/${orgId}` },
    { label: "Members", href: `/orgs/${orgId}/members` },
    { label: "Expenses", href: `/orgs/${orgId}/expenses` },
  ];

  return (
    <div className="flex gap-1 border-b border-border px-4">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "border-b-2 px-3 py-2.5 text-sm",
            pathname === t.href
              ? "border-accent text-ink"
              : "border-transparent text-ink-muted hover:text-ink"
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
