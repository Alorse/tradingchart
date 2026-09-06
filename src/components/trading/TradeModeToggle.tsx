"use client";

import { cn } from "@/lib/utils";
import type { TradingMode } from "@/lib/store/trading-mode-store";

/** Colours deliberately echo the TEST/LIVE badge in `OrderPanel`'s header. */
const MODES: Array<{ key: TradingMode; label: string; activeClass: string }> = [
  { key: "paper", label: "Paper", activeClass: "bg-tv-yellow/20 text-tv-yellow" },
  { key: "live", label: "Live", activeClass: "bg-tv-green/20 text-tv-green" },
];

/**
 * Paper/Live segmented control at the top of the Trade tab. "Which account is
 * this" must read the same way everywhere in the app — simulated fills must
 * never be visually confusable with a real order.
 */
export function TradeModeToggle({
  mode, onChange,
}: { mode: TradingMode; onChange: (mode: TradingMode) => void }) {
  return (
    <div className="flex gap-1 border-b border-tv-border bg-tv-panel p-1.5">
      {MODES.map(({ key, label, activeClass }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "flex-1 rounded px-2 py-1.5 text-[11px] font-semibold transition-colors",
            mode === key
              ? activeClass
              : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
