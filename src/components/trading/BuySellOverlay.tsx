"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useQuote } from "@/lib/trading/quote";
import { tradeGate } from "@/lib/trading/exchange-gate";
import type { OrderSide } from "@/lib/binance/trading-types";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BuySellOverlay() {
  const symbol = useChartStore((s) => s.symbol);
  const sidebarTab = useChartStore((s) => s.rightSidebarTab);
  const setSidebarTab = useChartStore((s) => s.setRightSidebarTab);
  const setTradingPanelOpen = useTradingStore((s) => s.setTradingPanelOpen);
  const updateForm = useTradingStore((s) => s.updateForm);
  const apiKey = useTradingStore((s) => s.apiKey);
  const exchange = useTradingStore((s) => s.exchange);
  const placeOrder = useTradingStore((s) => s.placeOrder);
  const isLoading = useTradingStore((s) => s.isLoading);
  // Live credentials stay configured while the Trade tab is toggled to
  // Paper — this quote/quick-order surface must never place a real order
  // just because it's still mounted (adversarial review finding 1).
  const mode = useTradingModeStore((s) => s.mode);

  const panelOpen = sidebarTab === "trade";
  // The chart's venue vs the connected account's. Blocks the double-click
  // market order rather than letting it fill on the other exchange's book.
  const gate = tradeGate(symbol, exchange);

  // Quotes from the venue the chart is actually on — otherwise a Bybit chart
  // would show Binance's book.
  const { bid, ask } = useQuote(symbol);
  const [flash, setFlash] = useState<OrderSide | null>(null);

  function togglePanel(open: boolean) {
    setSidebarTab(open ? "trade" : "watchlist");
    // Keeps the chart's order preview lines in step with the panel.
    setTradingPanelOpen(open);
  }

  /** Single click: bring up the order ticket pre-set to this side. */
  function openTicket(side: OrderSide) {
    updateForm({ side });
    togglePanel(true);
  }

  /** Double click: skip the ticket and send a market order straight away. */
  async function quickOrder(side: OrderSide) {
    if (!apiKey || isLoading) return;
    if (!gate.ok) {
      // Don't fire, and don't fail silently either: open the ticket, where the
      // submit button spells out the venue mismatch.
      togglePanel(true);
      return;
    }
    setFlash(side);
    setTimeout(() => setFlash(null), 300);
    await placeOrder(symbol, { side, type: "MARKET" });
  }

  if (mode !== "live" || !apiKey) return null;

  return (
    <div className="pointer-events-auto flex items-center gap-1">
      <button
        onClick={() => togglePanel(!panelOpen)}
        title={panelOpen ? "Hide the order panel" : "Show the order panel"}
        className={cn(
          "rounded border px-1.5 py-0.5 text-[9px] font-medium transition-colors",
          panelOpen
            ? "border-tv-blue bg-tv-blue/20 text-tv-blue-text"
            : "border-tv-border bg-tv-panel/80 text-tv-text-muted hover:border-tv-blue hover:text-tv-blue-text",
        )}
      >
        {panelOpen ? "▶ Panel" : "◀ Trade"}
      </button>

      <button
        onClick={() => openTicket("BUY")}
        onDoubleClick={() => quickOrder("BUY")}
        title={
          gate.ok
            ? "Click to open a buy ticket · double-click for an instant market buy"
            : gate.reason
        }
        className={cn(
          "flex flex-col items-center rounded px-2 py-0.5 text-[9px] font-semibold text-white transition-all",
          flash === "BUY" ? "scale-95 bg-tv-blue/60" : "bg-tv-blue hover:bg-tv-blue/80",
        )}
      >
        <span>Buy</span>
        {ask && <span className="font-normal opacity-80">{formatPrice(ask)}</span>}
      </button>

      <button
        onClick={() => openTicket("SELL")}
        onDoubleClick={() => quickOrder("SELL")}
        title={
          gate.ok
            ? "Click to open a sell ticket · double-click for an instant market sell"
            : gate.reason
        }
        className={cn(
          "flex flex-col items-center rounded px-2 py-0.5 text-[9px] font-semibold text-white transition-all",
          flash === "SELL" ? "scale-95 bg-tv-red/60" : "bg-tv-red hover:bg-tv-red/80",
        )}
      >
        <span>Sell</span>
        {bid && <span className="font-normal opacity-80">{formatPrice(bid)}</span>}
      </button>
    </div>
  );
}
