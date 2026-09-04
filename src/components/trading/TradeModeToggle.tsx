"use client";

import { cn } from "@/lib/utils";
import type { TradingMode } from "@/lib/store/trading-mode-store";

/**
 * Paper/Live segmented control at the top of the Trade tab. Colors deliberately
 * echo the existing TEST/LIVE badge in `OrderPanel`'s header (amber vs green)
 * so "which account is this" reads the same way everywhere in the app —
 * simulated fills must never be visually confusable with a real order.
 */
export function TradeModeToggle({
  mode, onChange,
}: { mode: TradingMode; onChange: (mode: TradingMode) => void }) {
  return (
    <div className="flex gap-1 border-b border-tv-border bg-tv-panel p-1.5">
      <button
        onClick={() => onChange("paper")}
        className={cn(
          "flex-1 rounded px-2 py-1.5 text-[11px] font-semibold transition-colors",
          mode === "paper"
            ? "bg-tv-yellow/20 text-tv-yellow"
            : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
        )}
      >
        Paper
      </button>
      <button
        onClick={() => onChange("live")}
        className={cn(
          "flex-1 rounded px-2 py-1.5 text-[11px] font-semibold transition-colors",
          mode === "live"
            ? "bg-tv-green/20 text-tv-green"
            : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
        )}
      >
        Live
      </button>
    </div>
  );
}
