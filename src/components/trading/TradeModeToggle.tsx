"use client";

import { cn } from "@/lib/utils";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { useTradingStore } from "@/lib/store/trading-store";
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
 *
 * Reads and writes `trading-mode-store` itself rather than taking
 * `{mode, onChange}`: both hosts (desktop `TradePanel`, mobile `TradeScreen`)
 * derived those two props from the same two stores with the same four
 * selectors, so switching to Live without credentials — a live-trading safety
 * rule — was written out twice and could diverge on one surface only.
 */
export function TradeModeToggle() {
  const mode = useTradingModeStore((s) => s.mode);
  const setMode = useTradingModeStore((s) => s.setMode);
  const apiKey = useTradingStore((s) => s.apiKey);
  const apiSecret = useTradingStore((s) => s.apiSecret);
  const setKeyDialogOpen = useTradingStore((s) => s.setApiKeyDialogOpen);

  function handleChange(next: TradingMode) {
    setMode(next);
    // No credentials yet: `OrderPanel` already falls back to its own
    // ConnectGate, but popping the dialog immediately saves the extra click
    // — this IS "the existing credential setup flow" the toggle routes to.
    if (next === "live" && (!apiKey || !apiSecret)) {
      setKeyDialogOpen(true);
    }
  }

  return (
    <div className="flex gap-1 border-b border-tv-border bg-tv-panel p-1.5">
      {MODES.map(({ key, label, activeClass }) => (
        <button
          key={key}
          onClick={() => handleChange(key)}
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
