"use client";

import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { useChartStore } from "@/lib/store/chart-store";
import { OrderPanel } from "@/components/trading/OrderPanel/OrderPanel";
import { PaperOrderPanel } from "@/components/trading/OrderPanel/PaperOrderPanel";
import { TradeModeToggle } from "@/components/trading/TradeModeToggle";

/**
 * Right sidebar's Trade tab: a Paper/Live toggle over whichever order panel
 * is active. Defaults to Paper (see `trading-mode-store.ts`) so a fresh
 * install can never place a real order before the user opts in.
 */
export function TradePanel() {
  const mode = useTradingModeStore((s) => s.mode);
  const symbol = useChartStore((s) => s.symbol);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TradeModeToggle />
      <div className="flex-1 overflow-hidden">
        {/* Inverted on purpose (checks "live", not "paper"): any unrecognized
            `mode` value must fail closed to the harmless panel, not open to
            the one that can place real orders (adversarial review finding 9;
            trading-mode-store's own `merge` now also sanitizes what can
            rehydrate into `mode` in the first place, belt and suspenders). */}
        {mode === "live" ? <OrderPanel /> : <PaperOrderPanel key={symbol} />}
      </div>
    </div>
  );
}
