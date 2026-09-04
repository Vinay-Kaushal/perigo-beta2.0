"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function TopBar({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  const { user, logout } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4">
      <nav className="flex items-center gap-1.5 text-sm text-ink-muted">
        <Link href="/orgs" className="font-mono font-medium text-accent">
          perigo
        </Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-ink-faint">/</span>
            {c.href ? (
              <Link href={c.href} className="hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className="text-ink">{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      {user && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Avatar name={user.name} size={22} />
            <span className="text-sm text-ink-muted">{user.name}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      )}
    </header>
  );
}
