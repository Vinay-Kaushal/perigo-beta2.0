"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import type { Organisation } from "@/lib/types";
import { LayoutDashboard, Building2, Wallet, User, Search } from "lucide-react";

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: React.ElementType;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [orgs, setOrgs] = useState<Organisation[]>([]);

  useEffect(() => {
    if (open) api.get<Organisation[]>("/organisations").then(setOrgs).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const staticItems: PaletteItem[] = [
    { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { id: "orgs", label: "Organisations", href: "/orgs", icon: Building2 },
    { id: "expenses", label: "Expenses", href: "/expenses", icon: Wallet },
    { id: "profile", label: "Profile & settings", href: "/profile", icon: User },
  ];

  const orgItems: PaletteItem[] = orgs.map((o) => ({
    id: `org-${o.id}`,
    label: o.name,
    sublabel: "Organisation",
    href: `/orgs/${o.id}/dashboard`,
    icon: Building2,
  }));

  const allItems = [...staticItems, ...orgItems];
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((i) => i.label.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, orgs]);

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40"
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Search size={15} className="text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "Enter" && filtered[0]) go(filtered[0].href);
                }}
                placeholder="Jump to…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
              <kbd className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-ink-faint">Esc</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ink-faint">No matches.</p>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => go(item.href)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-ink hover:bg-surface"
                  >
                    <item.icon size={15} className="text-ink-faint" />
                    <span>{item.label}</span>
                    {item.sublabel && <span className="ml-auto text-xs text-ink-faint">{item.sublabel}</span>}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
