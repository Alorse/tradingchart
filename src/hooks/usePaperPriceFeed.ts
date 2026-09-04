"use client";

import { useEffect } from "react";
import { getBinanceWS } from "@/lib/binance/ws";
import { getBybitWS } from "@/lib/bybit/ws";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { paperFeedSource } from "@/lib/trading/paper-feed";

/**
 * Drives the paper engine off the same live mini-ticker stream the watchlist
 * already subscribes to (`getBinanceWS`/`getBybitWS` are process-wide
 * singletons — this opens no new connection, just another listener on
 * whichever socket the symbol belongs to). Mounted per-symbol inside
 * `PriceChart`, so only the currently-charted symbol drives fills; a paper
 * position on a symbol that isn't charted goes stale until it's charted
 * again, same scope cut as the live chart's own order lines.
 *
 * `paperFeedSource` is the guard: stocks/macro/synthetic symbols have no live
 * tick stream here, so the hook skips subscribing entirely rather than
 * calling `evaluateTick` with a price that will never arrive.
 */
export function usePaperPriceFeed(symbol: string) {
  useEffect(() => {
    const source = paperFeedSource(symbol);
    if (!source) return;
    const evaluateTick = usePaperTradingStore.getState().evaluateTick;
    const ws = source === "bybit" ? getBybitWS() : getBinanceWS();
    return ws.subscribeMiniTickers([symbol], (t) => evaluateTick(symbol, t.close));
  }, [symbol]);
}
