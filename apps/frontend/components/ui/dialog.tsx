"use client";

import * as React from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * A small hand-rolled dialog rather than pulling in Radix — this project
 * only needs one modal pattern (task detail / forms), so the extra
 * dependency isn't worth it. Handles Escape-to-close, backdrop click, and
 * focus trapping is intentionally NOT implemented — worth adding
 * (or swapping for @radix-ui/react-dialog) before this ships to real users
 * who rely on a keyboard/screen reader.
 */
export function Dialog({ open, onClose, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-lg rounded-lg border border-border bg-surface-raised shadow-panel",
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-ink-faint hover:bg-surface hover:text-ink"
          aria-label="Close"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
