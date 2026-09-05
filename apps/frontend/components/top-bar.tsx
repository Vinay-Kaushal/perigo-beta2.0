"use client";

import Link from "next/link";

export function TopBar({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  return (
    <header className="flex h-14 items-center border-b border-border px-4">
      <nav className="flex items-center gap-1.5 text-sm text-ink-muted">
        {crumbs.length === 0 ? (
          <span className="font-mono font-medium text-ink">perigo</span>
        ) : (
          crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-faint">/</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink">{c.label}</span>
              )}
            </span>
          ))
        )}
      </nav>
    </header>
  );
}
