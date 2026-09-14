"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { MailWarning, Menu } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useAuth } from "@/lib/auth-context";
import { useChannelEvents, useRealtime } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Sidebar } from "./sidebar";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { cn } from "@/lib/utils";

const BARE_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/unsubscribe"];
const LAST_ORG_KEY = "perigo_last_org";

function VerifyEmailBanner({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[13px] text-ink">
      <MailWarning size={15} className="shrink-0 text-warning" />
      <span className="flex-1">
        Verify <strong className="font-medium">{email}</strong> to create organisations and invite people. Check your inbox for the link.
      </span>
      <Button
        variant="link"
        size="sm"
        loading={sending}
        onClick={async () => {
          setSending(true);
          try {
            await api.post("/auth/resend-verification");
            toast.success("Verification email sent");
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setSending(false);
          }
        }}
      >
        Resend email
      </Button>
    </div>
  );
}

function ConnectionDot() {
  const { state } = useRealtime();
  const label = state === "live" ? "Live updates on" : state === "connecting" ? "Connecting…" : "Offline — reconnecting";
  return (
    <Tooltip content={label}>
      <span className="flex h-8 items-center gap-1.5 px-2 text-2xs text-ink-faint" role="status" aria-label={label}>
        <span className={cn("h-2 w-2 rounded-full", state === "live" ? "bg-success" : state === "connecting" ? "animate-pulse bg-warning" : "bg-ink-faint")} />
        <span className="hidden sm:inline">{state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline"}</span>
      </span>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const { mutate } = useSWRConfig();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastOrg, setLastOrg] = useState<string | null>(null);

  const urlOrg = pathname.match(/^\/orgs\/([0-9a-f-]{36})/)?.[1] ?? null;
  const orgId = urlOrg ?? lastOrg;

  useEffect(() => {
    try {
      if (urlOrg) localStorage.setItem(LAST_ORG_KEY, urlOrg);
      setLastOrg(urlOrg ?? localStorage.getItem(LAST_ORG_KEY));
    } catch {
      setLastOrg(urlOrg);
    }
  }, [urlOrg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Membership changes pushed from the server: refresh org data, and leave an org you've lost.
  useChannelEvents(
    null,
    (event) => {
      if (event.type !== "ACCESS_REVOKED" && event.type !== "ACCESS_CHANGED") return;
      mutate((key) => typeof key === "string" && (key.startsWith("/organisations") || key.startsWith("/me/") || key.startsWith("/boards")));
      const revokedOrg = event.data?.organisationId as string | undefined;
      if (event.type === "ACCESS_REVOKED" && revokedOrg) {
        try {
          if (localStorage.getItem(LAST_ORG_KEY) === revokedOrg) localStorage.removeItem(LAST_ORG_KEY);
        } catch {}
        if (urlOrg === revokedOrg) {
          toast.error("Your access to this organisation was removed");
          router.replace("/orgs");
        }
      }
    },
    { personal: true }
  );

  const bare = BARE_ROUTES.includes(pathname) || pathname.startsWith("/invitations/") || (!user && !loading);
  if (bare) return <>{children}</>;
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-border md:block">
        <Sidebar orgId={orgId} onOpenSearch={() => setSearchOpen(true)} />
      </aside>

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border shadow-pop md:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <Sidebar orgId={orgId} onOpenSearch={() => (setDrawerOpen(false), setSearchOpen(true))} onNavigate={() => setDrawerOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur sm:px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <Menu size={18} />
          </Button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <ConnectionDot />
            <NotificationBell />
          </div>
        </header>
        {user && !user.emailVerifiedAt && <VerifyEmailBanner email={user.email} />}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} orgId={orgId} />
    </div>
  );
}
