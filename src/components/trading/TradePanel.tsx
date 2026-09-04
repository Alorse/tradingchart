"use client";

import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { useTradingStore } from "@/lib/store/trading-store";
import { OrderPanel } from "@/components/trading/OrderPanel/OrderPanel";
import { PaperOrderPanel } from "@/components/trading/OrderPanel/PaperOrderPanel";
import { TradeModeToggle } from "@/components/trading/TradeModeToggle";
import type { TradingMode } from "@/lib/store/trading-mode-store";

/**
 * Right sidebar's Trade tab: a Paper/Live toggle over whichever order panel
 * is active. Defaults to Paper (see `trading-mode-store.ts`) so a fresh
 * install can never place a real order before the user opts in.
 */
export function TradePanel() {
  const mode = useTradingModeStore((s) => s.mode);
  const setMode = useTradingModeStore((s) => s.setMode);
  const apiKey = useTradingStore((s) => s.apiKey);
  const apiSecret = useTradingStore((s) => s.apiSecret);
  const setKeyDialogOpen = useTradingStore((s) => s.setApiKeyDialogOpen);

  function handleModeChange(next: TradingMode) {
    setMode(next);
    // No credentials yet: `OrderPanel` already falls back to its own
    // ConnectGate, but popping the dialog immediately saves the extra click
    // — this IS "the existing credential setup flow" the toggle routes to.
    if (next === "live" && (!apiKey || !apiSecret)) {
      setKeyDialogOpen(true);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TradeModeToggle mode={mode} onChange={handleModeChange} />
      <div className="flex-1 overflow-hidden">
        {mode === "paper" ? <PaperOrderPanel /> : <OrderPanel />}
      </div>
    </div>
  );
}
