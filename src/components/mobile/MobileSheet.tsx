"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";

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
    <>
      {/* Dimmed scrim behind the sheet — the sheet itself ends up covering
          the whole viewport, but during the slide-in this is what keeps the
          not-yet-covered area from flashing raw (undimmed) content, so the
          transition reads as a modal opening rather than a hard cut. */}
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />
      <div
        className="pt-safe fixed inset-0 z-50 flex flex-col bg-tv-bg animate-in slide-in-from-bottom duration-200 ease-out"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-tv-border bg-tv-panel px-3 py-2.5">
          <span className="text-sm font-semibold">{title}</span>
          <IconButton
            onClick={onClose}
            className="text-tv-text-muted active:bg-tv-panel-hover"
            aria-label="Close"
          >
            <X className="size-5" />
          </IconButton>
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
      </div>
    </>
  );
}
