"use client";

import { useEffect, useState } from "react";
import { getBinanceWS } from "@/lib/binance/ws";
import { getBybitWS } from "@/lib/bybit/ws";
import { paperFeedSource, type PaperFeedSource } from "@/lib/trading/paper-feed";

export interface Quote {
  bid: number | null;
  ask: number | null;
  /** Which venue is quoting, or `null` if the symbol has no live feed. */
  source: PaperFeedSource;
}

/**
 * Live bid/ask for `symbol` from whichever venue actually quotes it.
 *
 * Only Binance and Bybit push a live stream through this app; stocks, macro
 * and synthetic expressions are REST-poll or computed, so they quote `null`
 * rather than sitting on a Binance stream that never ticks. Bybit has no
 * separate book-ticker stream (see CLAUDE.md's "Live data"), so its last
 * price stands in for both sides.
 *
 * The state is keyed by symbol: after a symbol change, the cached bid/ask
 * belong to the *previous* symbol, so this reports nulls until the first tick
 * of the new one arrives rather than briefly quoting the wrong instrument.
 *
 * This replaced three separate implementations — `useBookTicker` (Binance
 * only), `PaperOrderPanel`'s `usePaperQuote` and an inline effect in
 * `BuySellOverlay` — which each carried their own venue rule and their own
 * (or missing) staleness guard.
 */
export function useQuote(symbol: string): Quote {
  const source = paperFeedSource(symbol);
  const [state, setState] = useState<{ symbol: string; bid: number | null; ask: number | null }>(
    () => ({ symbol, bid: null, ask: null }),
  );

  useEffect(() => {
    if (source === "bybit") {
      return getBybitWS().subscribeMiniTickers([symbol], (t) =>
        setState({ symbol, bid: t.close, ask: t.close }),
      );
    }
    if (source === "binance") {
      return getBinanceWS().subscribeBookTicker(symbol, (d) =>
        setState({ symbol, bid: d.bid, ask: d.ask }),
      );
    }
  }, [symbol, source]);

  if (state.symbol !== symbol) return { bid: null, ask: null, source };
  return { bid: state.bid, ask: state.ask, source };
}
