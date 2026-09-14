"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Building2, CornerDownLeft, Home, Inbox, LifeBuoy, Search, Target, User, Wallet, Kanban, Users, Ticket } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Organisation, Paginated, Ticket as TicketT } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: React.ElementType;
  group: string;
}

export function CommandPalette({ open, onOpenChange, orgId }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [tickets, setTickets] = useState<TicketT[]>([]);
  const { data: orgs } = useApi<Organisation[]>(open ? "/organisations" : null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Server-side ticket search within the current org (debounced).
  useEffect(() => {
    if (!open || !orgId || query.trim().length < 2) return setTickets([]);
    const t = setTimeout(() => {
      api
        .get<Paginated<TicketT>>(`/organisations/${orgId}/tickets?q=${encodeURIComponent(query.trim())}&pageSize=6`)
        .then((r) => setTickets(r.items))
        .catch(() => setTickets([]));
    }, 180);
    return () => clearTimeout(t);
  }, [open, orgId, query]);

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { id: "home", label: "Home", href: "/dashboard", icon: Home, group: "Go to" },
      { id: "inbox", label: "Notifications", href: "/notifications", icon: Inbox, group: "Go to" },
      { id: "orgs", label: "Organisations", href: "/orgs", icon: Building2, group: "Go to" },
      { id: "profile", label: "Account settings", href: "/profile", icon: User, group: "Go to" },
    ];
    if (orgId) {
      base.push(
        { id: "o-desk", label: "Service desk", href: `/orgs/${orgId}/tickets`, icon: LifeBuoy, group: "This organisation" },
        { id: "o-new", label: "Raise a ticket", href: `/orgs/${orgId}/tickets?new=1`, icon: Ticket, group: "This organisation" },
        { id: "o-boards", label: "Projects", href: `/orgs/${orgId}/boards`, icon: Kanban, group: "This organisation" },
        { id: "o-exp", label: "Expenses", href: `/orgs/${orgId}/expenses`, icon: Wallet, group: "This organisation" },
        { id: "o-goals", label: "Goals", href: `/orgs/${orgId}/goals`, icon: Target, group: "This organisation" },
        { id: "o-people", label: "People", href: `/orgs/${orgId}/members`, icon: Users, group: "This organisation" }
      );
    }
    for (const o of orgs ?? []) {
      base.push({ id: `org-${o.id}`, label: o.name, sublabel: o.myRole.toLowerCase(), href: `/orgs/${o.id}`, icon: Building2, group: "Switch organisation" });
    }
    const q = query.trim().toLowerCase();
    const filtered = q ? base.filter((i) => i.label.toLowerCase().includes(q)) : base;
    const ticketItems = tickets.map<Item>((t) => ({
      id: `t-${t.id}`,
      label: t.title,
      sublabel: t.key,
      href: `/orgs/${t.organisationId}/tickets/${t.number}`,
      icon: Ticket,
      group: "Tickets",
    }));
    return [...ticketItems, ...filtered];
  }, [orgs, orgId, query, tickets]);

  useEffect(() => setIndex(0), [query, tickets.length]);

  function go(item: Item | undefined) {
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  }

  let lastGroup = "";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-pop data-[state=open]:animate-scale-in">
          <DialogPrimitive.Title className="sr-only">Search and jump</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages, organisations and tickets</DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search size={16} className="text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(items.length - 1, i + 1)));
                if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
                if (e.key === "Enter") go(items[index]);
              }}
              placeholder={orgId ? "Search pages, organisations, or tickets (e.g. TKT-42)…" : "Search pages and organisations…"}
              className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              aria-label="Search"
            />
            <kbd className="rounded border border-border px-1.5 text-2xs text-ink-faint">Esc</kbd>
          </div>
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
            {items.length === 0 && <p className="py-8 text-center text-[13px] text-ink-faint">No results</p>}
            {items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header && <div className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-ink-faint">{header}</div>}
                  <button
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => go(item)}
                    className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px]", i === index ? "bg-surface-hover text-ink" : "text-ink-muted")}
                  >
                    <item.icon size={15} className="text-ink-faint" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.sublabel && <span className="text-2xs text-ink-faint">{item.sublabel}</span>}
                    {i === index && <CornerDownLeft size={13} className="text-ink-faint" />}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
