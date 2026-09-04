"use client";

import { useEffect } from "react";
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
 * Re-subscribes only when the *set* of exposed feed symbols changes: the
 * selectors below reduce the account down to a joined string per venue, so a
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
  const binanceKey = usePaperTradingStore((s) => paperFeedExposure(s.account).binance.join(","));
  const bybitKey = usePaperTradingStore((s) => paperFeedExposure(s.account).bybit.join(","));

  useEffect(() => {
    if (!binanceKey) return;
    const evaluateTick = usePaperTradingStore.getState().evaluateTick;
    return getBinanceWS().subscribeMiniTickers(binanceKey.split(","), (t) =>
      evaluateTick(stripExchangePrefix(t.symbol), t.close),
    );
  }, [binanceKey]);

  useEffect(() => {
    if (!bybitKey) return;
    const evaluateTick = usePaperTradingStore.getState().evaluateTick;
    return getBybitWS().subscribeMiniTickers(bybitKey.split(","), (t) =>
      evaluateTick(stripExchangePrefix(t.symbol), t.close),
    );
  }, [bybitKey]);
}
