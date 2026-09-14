"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,

  ChevronsUpDown,
  Home,
  Inbox,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Target,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useApi } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { Organisation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, DropdownCheckItem } from "@/components/ui/dropdown";

function NavLink({ href, icon: Icon, label, active, badge, onNavigate }: { href: string; icon: React.ElementType; label: string; active: boolean; badge?: number; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-surface text-ink shadow-card ring-1 ring-border" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
      )}
    >
      <Icon size={16} className={active ? "text-accent" : "text-ink-faint group-hover:text-ink-muted"} />
      <span className="flex-1 truncate">{label}</span>
      {!!badge && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white dark:text-canvas">{badge > 99 ? "99+" : badge}</span>}
    </Link>
  );
}

export function Sidebar({ orgId, onOpenSearch, onNavigate }: { orgId: string | null; onOpenSearch: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const { data: orgs } = useApi<Organisation[]>("/organisations");
  const { data: unread } = useApi<{ count: number }>("/me/notifications/unread-count");
  const current = orgs?.find((o) => o.id === orgId) ?? null;
  const isAdmin = current?.myRole === "OWNER" || current?.myRole === "ADMIN";
  const base = orgId ? `/orgs/${orgId}` : "";

  const orgNav = orgId
    ? [
        { href: `${base}`, label: "Overview", icon: LayoutDashboard, exact: true },
        { href: `${base}/tickets`, label: "Service desk", icon: LifeBuoy },
        { href: `${base}/boards`, label: "Projects", icon: Kanban },
        { href: `${base}/goals`, label: "Goals", icon: Target },
        { href: `${base}/expenses`, label: "Expenses", icon: Wallet },
        { href: `${base}/members`, label: "People", icon: Users },
        ...(isAdmin ? [{ href: `${base}/settings`, label: "Settings", icon: Settings }] : []),
      ]
    : [];

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="p-3">
        <DropdownMenu>
          <DropdownTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-white dark:text-canvas">
              {(current?.name ?? "perigo").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{current?.name ?? "perigo"}</span>
              <span className="block truncate text-2xs text-ink-faint">{current ? current.myRole.toLowerCase() : "Choose an organisation"}</span>
            </span>
            <ChevronsUpDown size={14} className="text-ink-faint" />
          </DropdownTrigger>
          <DropdownContent align="start" className="w-64">
            <DropdownLabel>Organisations</DropdownLabel>
            {orgs?.map((o) => (
              <DropdownCheckItem key={o.id} checked={o.id === orgId} onSelect={() => (router.push(`/orgs/${o.id}`), onNavigate?.())}>
                <span className="flex-1 truncate">{o.name}</span>
              </DropdownCheckItem>
            ))}
            {orgs?.length === 0 && <p className="px-2 py-1.5 text-xs text-ink-faint">You haven&apos;t joined any yet.</p>}
            <DropdownSeparator />
            <DropdownItem onSelect={() => (router.push("/orgs?new=1"), onNavigate?.())}>
              <Plus size={14} /> Create organisation
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>

        <button
          onClick={onOpenSearch}
          className="mt-2 flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink-faint shadow-card hover:border-border-strong"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border bg-surface-muted px-1 text-[10px]">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        <div className="space-y-0.5">
          <NavLink href="/dashboard" icon={Home} label="Home" active={isActive("/dashboard")} onNavigate={onNavigate} />
          <NavLink href="/notifications" icon={Inbox} label="Inbox" active={isActive("/notifications")} badge={unread?.count} onNavigate={onNavigate} />
          <NavLink href="/orgs" icon={Building2} label="Organisations" active={pathname === "/orgs"} onNavigate={onNavigate} />
        </div>

        {current && (
          <div>
            <div className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{current.name}</div>
            <div className="space-y-0.5">
              {orgNav.map((item) => (
                <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} active={isActive(item.href, item.exact)} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        )}
      </nav>

      {user && (
        <div className="border-t border-border p-3">
          <DropdownMenu>
            <DropdownTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover">
              <Avatar name={user.name} src={user.avatarUrl} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
                <span className="block truncate text-2xs text-ink-faint">{user.email}</span>
              </span>
            </DropdownTrigger>
            <DropdownContent align="start" side="top" className="w-60">
              <DropdownItem onSelect={() => (router.push("/profile"), onNavigate?.())}>
                <User size={14} /> Account settings
              </DropdownItem>
              <DropdownSeparator />
              <DropdownLabel>Theme</DropdownLabel>
              <DropdownCheckItem checked={preference === "light"} onSelect={() => setPreference("light")}>
                <Sun size={14} /> Light
              </DropdownCheckItem>
              <DropdownCheckItem checked={preference === "dark"} onSelect={() => setPreference("dark")}>
                <Moon size={14} /> Dark
              </DropdownCheckItem>
              <DropdownCheckItem checked={preference === "system"} onSelect={() => setPreference("system")}>
                <Monitor size={14} /> System
              </DropdownCheckItem>
              <DropdownSeparator />
              <DropdownItem destructive onSelect={logout}>
                <LogOut size={14} /> Sign out
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}


