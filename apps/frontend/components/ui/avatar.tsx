import { cn, initials } from "@/lib/utils";

const PALETTE = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#2563eb", "#dc2626"];

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({
  name,
  src,
  size = 24,
  ring,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  ring?: string;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.4), boxShadow: ring ? `0 0 0 2px ${ring}` : undefined };
  if (src && /^https?:\/\//.test(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} title={name} referrerPolicy="no-referrer" className={cn("shrink-0 rounded-full object-cover", className)} style={style} />;
  }
  return (
    <span
      title={name}
      aria-label={name}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ ...style, backgroundColor: colorFor(name) }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ users, max = 3, size = 22 }: { users: Array<{ id: string; name: string; avatarUrl?: string | null }>; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((u) => (
        <Avatar key={u.id} name={u.name} src={u.avatarUrl} size={size} className="ring-2 ring-surface" />
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-surface-muted text-2xs font-medium text-ink-muted ring-2 ring-surface" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </div>
  );
}
