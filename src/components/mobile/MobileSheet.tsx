"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fullscreen mobile sheet that slides up from the bottom edge of the viewport.
 * Used for symbol search, indicators picker, drawing tools, etc — anything
 * that needs more space than a popover but should feel native on touch.
 */
export function MobileSheet({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className="pt-safe fixed inset-0 z-50 flex flex-col bg-tv-bg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-tv-border bg-tv-panel px-3 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <button
          onClick={onClose}
          className="rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
    </div>
  );
}
