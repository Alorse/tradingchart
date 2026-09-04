"use client";

import { useEffect } from "react";
import { Bell, X } from "lucide-react";
import { useToastStore } from "@/lib/alerts/toast-store";

export function AlertsToast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  // Auto-dismiss expired toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const t of toasts) {
        if (t.expiresAt > 0 && t.expiresAt <= now) dismiss(t.id);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-tv-border bg-tv-panel p-3 shadow-lg"
        >
          <div className={t.variant === "alert" ? "text-tv-yellow" : "text-tv-blue-text"}>
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-tv-text">{t.title}</div>
            {t.message && (
              <div className="mt-0.5 text-xs text-tv-text-muted">{t.message}</div>
            )}
          </div>
          <button
            onClick={() => dismiss(t.id)}
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
