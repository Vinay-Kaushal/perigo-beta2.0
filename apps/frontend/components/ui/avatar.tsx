import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Deterministic background from the name so the same person always gets
// the same avatar color across sessions, independent of presence color.
const PALETTE = ["#7C6CF6", "#4FB0FF", "#3DD68C", "#F5A623", "#F2545B", "#EC4899"];
function bgFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function Avatar({
  name,
  size = 24,
  ringColor,
  className,
}: {
  name: string;
  size?: number;
  ringColor?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center justify-center rounded-full font-medium text-white shrink-0", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: bgFor(name),
        boxShadow: ringColor ? `0 0 0 2px ${ringColor}` : undefined,
      }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
