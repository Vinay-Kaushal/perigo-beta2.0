"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Plus, Users, LifeBuoy, Kanban, Lock } from "lucide-react";
import { useSWRConfig } from "swr";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Organisation } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, InlineAlert, Skeleton } from "@/components/ui/feedback";
import { titleCase } from "@/lib/utils";

const slugify = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api.post<Organisation>("/organisations", { name, slug, description: description || undefined });
      await mutate("/organisations");
      onOpenChange(false);
      router.push(`/orgs/${org.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create organisation"
      description="You'll be the owner. Invite your team next."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-org" loading={busy} disabled={!name.trim() || slug.length < 2}>
            Create
          </Button>
        </>
      }
    >
      <form id="create-org" onSubmit={submit} className="space-y-4">
        <Field label="Name" htmlFor="org-name">
          <Input
            id="org-name"
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="Acme Inc."
          />
        </Field>
        <Field label="URL slug" htmlFor="org-slug" hint="Lowercase letters, numbers and dashes.">
          <Input
            id="org-slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Description" htmlFor="org-desc">
          <Textarea id="org-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Dialog>
  );
}

function OrgsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, isLoading } = useApi<Organisation[]>("/organisations");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (params.get("new") === "1") {
      setOpen(true);
      router.replace("/orgs");
    }
  }, [params, router]);

  return (
    <Page>
      <PageHeader
        title="Organisations"
        description="Workspaces you belong to. You can only join an organisation by invitation."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> New organisation
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="You're not in an organisation yet"
            description="Create one for your team, or ask an admin to invite you by email."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus size={15} /> Create organisation
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((o) => (
            <Link key={o.id} href={`/orgs/${o.id}`} className="group">
              <Card className="h-full p-4 transition-colors group-hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-sm font-bold text-accent-ink">{o.name.charAt(0).toUpperCase()}</span>
                  {o.locked ? (
                    <Badge tone="warning" title="Turn on two-factor authentication to open this organisation">
                      <Lock size={11} /> 2FA required
                    </Badge>
                  ) : (
                    <Badge tone={o.myRole === "MEMBER" ? "neutral" : "accent"}>{titleCase(o.myRole)}</Badge>
                  )}
                </div>
                <p className="mt-3 font-semibold text-ink">{o.name}</p>
                <p className="line-clamp-2 min-h-[36px] text-[13px] text-ink-muted">{o.description || `/${o.slug}`}</p>
                <div className="mt-3 flex gap-4 border-t border-border pt-3 text-xs text-ink-faint">
                  <span className="flex items-center gap-1">
                    <Users size={12} /> {o._count?.members ?? 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <LifeBuoy size={12} /> {o._count?.tickets ?? 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <Kanban size={12} /> {o._count?.boards ?? 0}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreateOrgDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

export default function OrgsPage() {
  return (
    <Suspense>
      <OrgsInner />
    </Suspense>
  );
}
