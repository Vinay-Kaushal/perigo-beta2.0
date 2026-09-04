"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { Organisation } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { Plus, Building2 } from "lucide-react";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function OrgsPage() {
  const [orgs, setOrgs] = useState<Organisation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    try {
      setOrgs(await api.get<Organisation[]>("/organisations"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load organisations");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[]} />

      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-medium text-ink">Your organisations</h1>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus size={15} /> New organisation
          </Button>
        </div>

        {error && <p className="mb-4 text-sm text-urgent">{error}</p>}

        {orgs === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : orgs.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Building2 className="text-ink-faint" size={28} />
            <p className="text-sm text-ink-muted">
              You&apos;re not part of an organisation yet. Create one to start a board.
            </p>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus size={15} /> New organisation
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {orgs.map((org) => (
              <Link key={org.id} href={`/orgs/${org.id}`}>
                <Card className="flex h-full flex-col gap-1 p-4 transition-colors hover:border-border-hover">
                  <div className="flex items-center gap-2">
                    <Building2 size={16} className="text-accent" />
                    <span className="font-medium text-ink">{org.name}</span>
                  </div>
                  {org.description && (
                    <p className="line-clamp-2 text-sm text-ink-muted">{org.description}</p>
                  )}
                  <span className="mt-auto pt-2 text-xs text-ink-faint">{org.myRole}</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <CreateOrgDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function CreateOrgDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/organisations", { name, slug: slugify(name), description: description || undefined });
      setName("");
      setDescription("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create organisation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <h2 className="text-sm font-medium text-ink">New organisation</h2>
        <div className="space-y-1.5">
          <Label htmlFor="org-name">Name</Label>
          <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-desc">Description (optional)</Label>
          <Input id="org-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p className="text-sm text-urgent">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
