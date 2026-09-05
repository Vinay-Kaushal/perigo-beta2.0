"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[{ label: "Profile" }]} />

      <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
        <div className="flex items-center gap-3">
          <Avatar name={user?.name ?? "?"} size={48} />
          <div>
            <p className="font-medium text-ink">{user?.name}</p>
            <p className="text-sm text-ink-faint">{user?.email}</p>
          </div>
        </div>

        {user && <ProfileForm user={user} onSaved={refreshUser} />}
        <PasswordForm />
      </div>
    </div>
  );
}

function ProfileForm({ user, onSaved }: { user: User; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.patch("/auth/me", { name, avatarUrl: avatarUrl || null });
      await onSaved();
      setMessage({ type: "ok", text: "Saved." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof ApiError ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-medium text-ink">Profile</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="avatarUrl">Avatar URL (optional)</Label>
          <Input
            id="avatarUrl"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
        </div>
        {message && (
          <p className={`text-sm ${message.type === "ok" ? "text-success" : "text-urgent"}`}>{message.text}</p>
        )}
        <Button type="submit" size="sm" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setMessage({ type: "ok", text: "Password updated." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof ApiError ? err.message : "Failed to change password" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-medium text-ink">Change password</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        {message && (
          <p className={`text-sm ${message.type === "ok" ? "text-success" : "text-urgent"}`}>{message.text}</p>
        )}
        <Button type="submit" size="sm" disabled={saving || !currentPassword || newPassword.length < 8}>
          {saving ? "Updating…" : "Update password"}
        </Button>
      </form>
    </Card>
  );
}
