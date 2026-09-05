"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { describePaperEvent } from "@/lib/trading/paper-format";
import { cn } from "@/lib/utils";

interface PaperToast {
  id: string;
  text: string;
  variant: "fill" | "close" | "cancel" | "reject";
  expiresAt: number;
}

const TTL_MS = 5000;

/**
 * Bottom-left toasts for paper-trading fills/closes/cancels/rejects —
 * bottom-LEFT specifically so they never collide with `AlertsToast`'s
 * bottom-right stack. Mounted globally (`providers.tsx`), not inside
 * `PaperPositionsPanel`, so an event still surfaces while the panel is
 * collapsed or the user has switched to the live-mode tab; `lastEvents` is
 * replaced-not-appended on the store, so this keeps its own locally-owned,
 * auto-expiring list rather than reading the store array directly.
 */
export function PaperTradeToasts() {
  const lastEvents = usePaperTradingStore((s) => s.lastEvents);
  const [toasts, setToasts] = useState<PaperToast[]>([]);

  useEffect(() => {
    if (lastEvents.length === 0) return;
    const now = Date.now();
    const next: PaperToast[] = lastEvents.map((e, i) => ({
      id: `${now}-${i}`,
      text: describePaperEvent(e),
      variant: e.type,
      expiresAt: now + TTL_MS,
    }));
    // Subscribing to an external store's replace-not-append signal and
    // folding it into a locally-owned, auto-expiring accumulator.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToasts((prev) => [...prev, ...next]);
  }, [lastEvents]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 500);
    return () => clearInterval(interval);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-tv-border bg-tv-panel p-3 shadow-lg"
        >
          <div
            className={cn(
              t.variant === "reject" && "text-tv-red",
              t.variant === "close" && "text-tv-green",
              (t.variant === "fill" || t.variant === "cancel") && "text-tv-blue-text",
            )}
          >
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm text-tv-text">{t.text}</div>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="text-tv-text-muted hover:text-tv-text"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
