"use client";

import { useEffect, useMemo } from "react";
import { getBinanceWS } from "@/lib/binance/ws";
import { stripExchangePrefix } from "@/lib/symbols/prefix";
import { getBybitWS } from "@/lib/bybit/ws";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { paperFeedExposure } from "@/lib/trading/paper-feed";

/**
 * Drives the paper engine off every symbol the account actually has exposure
 * to — an open position or a resting order — not just whatever happens to be
 * charted. A position on BTC used to go stale the moment the user charted
 * ETH (adversarial re-audit finding 10); this replaces the old per-symbol
 * `usePaperPriceFeed` that was mounted inside `PriceChart`. Mounted once in
 * `providers.tsx`, alongside the other cross-cutting hooks.
 *
 * `getBinanceWS`/`getBybitWS` are process-wide singletons — this opens no new
 * connection, just more listeners on whichever socket each symbol belongs to
 * (both fan out to a `Set` per topic now, so overlapping subscribers, e.g.
 * this hook and the watchlist, never steal each other's stream).
 *
 * Re-subscribes only when the *set* of exposed feed symbols changes:
 * `useVenueFeed` keys its effect on the joined symbol list per venue, so a
 * mark-only tick (which still touches the store on every price update, see
 * `evaluateTick`'s comment) doesn't tear down and rebuild the sockets — only
 * a position opening, closing, or an order filling/cancelling does.
 *
 * Both sockets echo back the exact symbol they were subscribed with, so a
 * tick's `symbol` is still the decorated feedSymbol — `stripExchangePrefix`
 * (not `cleanSym`) turns it into the key positions and orders are stored
 * under, keeping `.P` so a perp's ticks can't be applied to a spot position
 * of the same ticker (holistic review finding 4).
 */
export function usePaperExposureFeed() {
  // One selector reading a reference, not two that each rebuild the exposure.
  // `evaluateTick` calls `set` on mark-only ticks but returns the *same*
  // `account`, so the memo below recomputes on real mutations only — where
  // two `paperFeedExposure` selectors used to run on every price update.
  const account = usePaperTradingStore((s) => s.account);
  const exposure = useMemo(() => paperFeedExposure(account), [account]);

  useVenueFeed(getBinanceWS, exposure.binance);
  useVenueFeed(getBybitWS, exposure.bybit);
}

/** Minimum both WS singletons expose — they were built to match (CLAUDE.md,
 *  "Live data"), which is what lets one hook serve either venue. */
interface MiniTickerSource {
  subscribeMiniTickers(
    symbols: string[],
    onTick: (t: { symbol: string; close: number }) => void,
  ): () => void;
}

/** Feeds one venue's exposed symbols into the engine, resubscribing only when
 *  that symbol *set* changes rather than on every array identity. */
function useVenueFeed(getWS: () => MiniTickerSource, symbols: string[]) {
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    const evaluateTick = usePaperTradingStore.getState().evaluateTick;
    return getWS().subscribeMiniTickers(key.split(","), (t) =>
      evaluateTick(stripExchangePrefix(t.symbol), t.close),
    );
  }, [key, getWS]);
}
