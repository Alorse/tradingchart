"use client";

import { useEffect, useState } from "react";
import { getBinanceWS } from "./ws";
import { sourceKindOf } from "@/lib/symbols/source";

/** Subscribes to the symbol's book-ticker stream and returns live bid/ask.
 *  Internally keyed by symbol so callers don't see stale prices when the
 *  symbol changes — the per-symbol state is wiped via remount of the inner
 *  state hooks (key={symbol} pattern at the caller is not required).
 *
 *  Binance's bookTicker stream only exists for Binance-sourced symbols —
 *  subscribing it for a Bybit-charted (or feedless) symbol would silently
 *  sit on a stream that never ticks, so this is a no-op (permanently null
 *  bid/ask) for anything else, leaving venue-aware quoting to the caller. */
export function useBookTicker(symbol: string): { bid: number | null; ask: number | null } {
  const [state, setState] = useState<{ symbol: string; bid: number | null; ask: number | null }>(
    () => ({ symbol, bid: null, ask: null }),
  );

  useEffect(() => {
    if (sourceKindOf(symbol) !== "binance") return;
    const ws = getBinanceWS();
    return ws.subscribeBookTicker(symbol, (data) => {
      setState({ symbol, bid: data.bid, ask: data.ask });
    });
  }, [symbol]);

  // If the symbol prop changed but no new tick has arrived yet, the cached
  // bid/ask belong to the previous symbol — return nulls in that window.
  if (state.symbol !== symbol) return { bid: null, ask: null };
  return { bid: state.bid, ask: state.ask };
}
