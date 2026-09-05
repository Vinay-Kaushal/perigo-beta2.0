"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

const FEATURES = [
  "Realtime boards your whole team sees update live",
  "Org-wide analytics, activity feed, and PDF reports",
  "Built-in expense tracking and spending goals",
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-canvas p-10 lg:flex">
        {/* Two soft, slowly-drifting glows — purely decorative, gives the
            panel some life without competing with the actual content. */}
        <motion.div
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl"
          animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-success/20 blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 font-mono text-lg font-medium text-ink"
        >
          perigo
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative z-10 max-w-md"
        >
          <h2 className="mb-6 text-2xl font-medium leading-snug text-ink">
            The workspace for teams who ship.
          </h2>
          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-ink-muted">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                {f}
              </li>
            ))}
          </ul>
        </motion.div>

        <div className="relative z-10 text-xs text-ink-faint">© {new Date().getFullYear()} perigo</div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-sm"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
