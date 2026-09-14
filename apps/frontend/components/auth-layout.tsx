import { CheckCircle2, LifeBuoy } from "lucide-react";

const POINTS = [
  "A realtime service desk — tickets, SLAs and assignment everyone sees instantly",
  "Invite-and-approve onboarding with a full audit trail",
  "Expense approvals, goal tracking and dashboards in one place",
];

export function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white dark:text-canvas">
            <LifeBuoy size={15} />
          </span>
          perigo
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </div>
        <p className="text-xs text-ink-faint">© {new Date().getFullYear()} perigo</p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-border bg-surface-muted lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(var(--accent)/0.12),transparent_55%)]" />
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-ink">Work management for teams</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink">Every request tracked. Every owner clear.</h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-sm text-ink-muted">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
