"use client";

import { Avatar } from "@/components/ui/avatar";

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
}

export function PresenceBar({ users, connected }: { users: PresenceUser[]; connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: connected ? "#3DD68C" : "#565E6D" }}
        title={connected ? "Live" : "Reconnecting…"}
      />
      <div className="flex -space-x-1.5">
        {users.map((u) => (
          <Avatar key={u.userId} name={u.name} size={24} ringColor={u.color} className="ring-2 ring-canvas" />
        ))}
      </div>
    </div>
  );
}
