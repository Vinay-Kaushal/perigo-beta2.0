"use client";

import { useEffect, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/dialog";
import { fullDate } from "@/lib/utils";

export default function ProfilePage() {
  const { user, refreshUser, adoptSession, logoutEverywhere } = useAuth();
  const [me, setMe] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [changing, setChanging] = useState(false);
  const [signOutAll, setSignOutAll] = useState(false);

  useEffect(() => {
    api.get<User>("/auth/me").then((u) => {
      setMe(u);
      setName(u.name);
      setAvatarUrl(u.avatarUrl ?? "");
    });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/auth/me", { name, avatarUrl: avatarUrl.trim() || null });
      await refreshUser();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return toast.error("New passwords don't match");
    setChanging(true);
    try {
      const session = await api.post<{ token: string; user: User }>("/auth/change-password", { currentPassword: current, newPassword: next });
      adoptSession(session);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed. Other sessions have been signed out.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChanging(false);
    }
  }

  if (!user) return null;

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Account settings" description="Manage your profile and security." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" description="Visible to members of your organisations." />
          <form onSubmit={saveProfile} className="space-y-4 p-4">
            <div className="flex items-center gap-4">
              <Avatar name={name || user.name} src={avatarUrl || null} size={56} />
              <div className="text-[13px] text-ink-muted">
                <p className="font-medium text-ink">{user.email}</p>
                {me?.createdAt && <p className="text-xs">Member since {fullDate(me.createdAt)}</p>}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="name">
                <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Avatar URL" htmlFor="avatar" hint="An https:// image link. Leave empty for initials.">
                <Input id="avatar" type="url" placeholder="https://…" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Password" description="Changing your password signs you out of every other device." />
          <form onSubmit={changePassword} className="grid gap-4 p-4 sm:grid-cols-3">
            <Field label="Current password" htmlFor="cur">
              <Input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" htmlFor="new" hint="8+ characters, a letter and a number">
              <Input id="new" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm">
              <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <div className="flex justify-end sm:col-span-3">
              <Button type="submit" loading={changing}>
                Update password
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Sessions" />
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3 text-[13px] text-ink-muted">
              <ShieldCheck size={18} className="shrink-0 text-success" />
              <div>
                <p className="text-ink">Sign out everywhere</p>
                <p className="text-xs">Immediately revokes access on every device and browser, including this one.</p>
                {me?.lastLoginAt && <p className="mt-1 text-xs text-ink-faint">Last sign-in {fullDate(me.lastLoginAt)}</p>}
              </div>
            </div>
            <Button variant="secondary" onClick={() => setSignOutAll(true)}>
              <LogOut size={14} /> Sign out everywhere
            </Button>
          </div>
        </Card>
      </div>
      <ConfirmDialog open={signOutAll} onOpenChange={setSignOutAll} title="Sign out of all sessions?" description="You'll need to sign in again on every device." confirmLabel="Sign out everywhere" destructive onConfirm={logoutEverywhere} />
    </Page>
  );
}
