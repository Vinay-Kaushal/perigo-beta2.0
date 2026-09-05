"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Organisation } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Wallet,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Search,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Organisations", href: "/orgs", icon: Building2 },
  { label: "Expenses", href: "/expenses", icon: Wallet },
  // Add future top-level sections here — this list is the whole nav surface.
];

export function Sidebar({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [orgs, setOrgs] = useState<Organisation[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("perigo_sidebar_collapsed");
    if (saved === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("perigo_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    api.get<Organisation[]>("/organisations").then(setOrgs).catch(() => {});
  }, [pathname]);

  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 232 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="flex h-screen shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <Link href="/dashboard" className="font-mono text-sm font-medium text-accent">
            perigo
          </Link>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-1.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <button
        onClick={onOpenCommandPalette}
        className={cn(
          "mx-2 mb-2 flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-ink-faint hover:border-border-hover hover:text-ink",
          collapsed && "justify-center"
        )}
      >
        <Search size={13} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded bg-surface-raised px-1 py-0.5 text-[10px]">⌘K</kbd>
          </>
        )}
      </button>

      <nav className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                active ? "bg-surface-raised text-ink" : "text-ink-muted hover:bg-surface-raised hover:text-ink",
                collapsed && "justify-center"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={16} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-4 flex-1 overflow-y-auto px-2">
          <div className="mb-1 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Organisations</span>
            <Link href="/orgs" className="text-ink-faint hover:text-ink" aria-label="New organisation">
              <Plus size={13} />
            </Link>
          </div>
          <div className="flex flex-col gap-0.5">
            {orgs.map((org) => (
              <Link
                key={org.id}
                href={`/orgs/${org.id}/dashboard`}
                className={cn(
                  "truncate rounded-md px-2.5 py-1.5 text-sm",
                  pathname.startsWith(`/orgs/${org.id}`)
                    ? "bg-surface-raised text-ink"
                    : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                )}
              >
                {org.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      {collapsed && <div className="flex-1" />}

      {user && (
        <div className={cn("flex items-center gap-2 border-t border-border p-2.5", collapsed && "flex-col")}>
          <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80">
            <Avatar name={user.name} size={24} />
            {!collapsed && <span className="truncate text-sm text-ink-muted">{user.name}</span>}
          </Link>
          <button
            onClick={logout}
            className="rounded p-1.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
            aria-label="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      )}
    </motion.aside>
  );
}
