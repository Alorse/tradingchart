"use client";

import { useEffect } from "react";
import { getBinanceWS } from "@/lib/binance/ws";
import { cleanSym } from "@/lib/binance/rest";
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
 *
 * The WS subscription itself needs the raw, decorated `symbol` (the `.P`/
 * `BYBIT:` decoration is what routes it to the right connection/topic), but
 * `evaluateTick` is called with `cleanSym(symbol)` — the same canonical key
 * `paperFormToMarketRequest` now stores orders/positions under, so a tick for
 * a perp or Bybit-prefixed chart actually reaches them (adversarial review
 * finding 3).
 */
export function usePaperPriceFeed(symbol: string) {
  useEffect(() => {
    const source = paperFeedSource(symbol);
    if (!source) return;
    const evaluateTick = usePaperTradingStore.getState().evaluateTick;
    const canonical = cleanSym(symbol);
    const ws = source === "bybit" ? getBybitWS() : getBinanceWS();
    return ws.subscribeMiniTickers([symbol], (t) => evaluateTick(canonical, t.close));
  }, [symbol]);
}
