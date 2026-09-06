"use client";

import { useEffect, useRef } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useToastStore } from "@/lib/alerts/toast-store";
import { formatPrice } from "@/lib/format";
import type { Position } from "@/lib/binance/trading-types";

/**
 * Global trading sync. Keeps positions / orders / balance fresh whenever Live
 * mode is on and credentials are set, independent of whether any trading panel
 * is open — so the chart's EP / SL / TP / liquidation lines always reflect the
 * live account.
 *
 * Also keeps `allPositions` (every open position on the account, not just the
 * chart's current symbol) fresh, so the watchlist can badge any row with an
 * open trade, and raises a toast when a position opens, is added to, or closes.
 *
 * This is the **only** account poll in the app: `PositionsPanel`, `TradeScreen`
 * and `OrderPanel` render whatever this last wrote. Don't add a second
 * interval elsewhere — that was exactly the bug that multiplied the bill.
 *
 * Each tick fires signed requests to `/api/trade/*` — real Vercel Function
 * invocations billed against Fluid Active CPU. Three things keep that cheap:
 *
 *  1. One batched request to `/api/trade/sync` per tick (balance + orders +
 *     positions in a single invocation) instead of three separate routes,
 *     each of which would also drag the auth middleware along with it.
 *  2. The loop pauses entirely while the tab is in the background (Page
 *     Visibility API), resuming with an immediate refresh on foreground.
 *  3. The interval adapts: a flat account with no working orders has nothing
 *     that can change without the user acting, so it polls slowly. Any open
 *     position or resting order snaps it back to the fast rate.
 */

/** Fast enough that a fill shows up on the chart almost immediately. Used
 *  whenever the account has something live to watch. */
const POLL_FAST_MS = 2000;
/** Flat and no resting orders: nothing can change on its own, so the only
 *  thing this catches is a fill from another device. */
const POLL_IDLE_MS = 15000;

/** Hedge-mode accounts can hold both directions on one symbol. */
function positionKey(p: Position): string {
  return `${p.symbol}#${p.positionIdx ?? 0}`;
}

function openPositions(list: Position[]): Map<string, Position> {
  return new Map(list.filter((p) => p.positionAmt !== 0).map((p) => [positionKey(p), p]));
}

export function useTradingSync() {
  const apiKey = useTradingStore((s) => s.apiKey);
  const apiSecret = useTradingStore((s) => s.apiSecret);
  const exchange = useTradingStore((s) => s.exchange);
  const testnet = useTradingStore((s) => s.testnet);
  const symbol = useChartStore((s) => s.symbol);
  // Credentials alone aren't enough: they can stay configured while the Trade
  // tab is toggled back to Paper, and every consumer of what this writes
  // (`PositionsPanel`, `TradeScreen`, the chart's order lines) is suppressed
  // in Paper mode. Polling then bills `/api/trade/*` invocations to feed
  // panels that render nothing. Paper trading runs entirely off
  // `paper-trading-store` + localStorage and touches none of these routes.
  const liveMode = useTradingModeStore((s) => s.mode) === "live";

  /** False until the first snapshot lands, so pre-existing positions don't
   *  announce themselves as fresh fills on load or after switching accounts. */
  const seededRef = useRef(false);
  useEffect(() => {
    seededRef.current = false;
  }, [apiKey, apiSecret, exchange, testnet, liveMode]);

  useEffect(() => {
    if (!liveMode || !apiKey || !apiSecret) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentDelay = 0;

    /** Anything the exchange can change on its own: an open position (P&L,
     *  liquidation, a TP/SL firing) or a resting order that could fill. */
    function hasLiveActivity(): boolean {
      const s = useTradingStore.getState();
      if (s.allPositions.some((p) => p.positionAmt !== 0)) return true;
      return s.orders.some((o) => o.status === "NEW" || o.status === "PARTIALLY_FILLED");
    }

    async function refresh() {
      await useTradingStore.getState().syncAccount(symbol);
      if (!cancelled) seededRef.current = true;
    }

    // A self-rescheduling timeout rather than setInterval: the delay is
    // re-evaluated after every tick, so opening a position speeds the loop up
    // immediately and closing the last one lets it fall back to idle.
    function schedule() {
      if (cancelled || document.hidden) return;
      const delay = hasLiveActivity() ? POLL_FAST_MS : POLL_IDLE_MS;
      currentDelay = delay;
      timer = setTimeout(async () => {
        // Clear the handle *before* awaiting: the store writes that `refresh`
        // performs wake the re-arm subscription below, and a non-null `timer`
        // would let it schedule a second timeout that this one then orphans,
        // silently doubling the poll rate.
        timer = null;
        await refresh();
        schedule();
      }, delay);
    }

    function stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    // Background tabs don't need live account data — pausing here is the
    // single biggest lever on invocation volume, since a trading dashboard is
    // routinely left open (and backgrounded) for hours.
    function onVisibilityChange() {
      if (document.hidden) {
        stop();
      } else {
        stop();
        void refresh().then(schedule);
      }
    }

    void refresh().then(schedule);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Re-arm early when the account goes from idle to active between ticks
    // (e.g. an order placed from this tab), so the first fill isn't waited
    // out at the slow rate.
    const unsubActivity = useTradingStore.subscribe((state, prev) => {
      if (cancelled || document.hidden || timer === null) return;
      if (state.allPositions === prev.allPositions && state.orders === prev.orders) return;
      if (currentDelay === POLL_IDLE_MS && hasLiveActivity()) {
        stop();
        schedule();
      }
    });

    return () => {
      cancelled = true;
      stop();
      unsubActivity();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [liveMode, apiKey, apiSecret, exchange, testnet, symbol]);

  // Clear the order ticket when the chart moves to another symbol. `qty` is
  // canonical and sized for one instrument, but it used to survive a symbol
  // switch untouched — and `BuySellOverlay`'s double-click fires a MARKET
  // order with it, with no confirmation and the ticket panel possibly closed,
  // so the stale size wasn't even on screen. Skips the first run so a form
  // filled before this hook mounts isn't wiped.
  const symbolSeenRef = useRef(false);
  useEffect(() => {
    if (!symbolSeenRef.current) {
      symbolSeenRef.current = true;
      return;
    }
    useTradingStore.getState().resetForm();
  }, [symbol]);

  // Announce fills by diffing consecutive position snapshots. Without a signed
  // user-data socket this is the reliable signal: the exchange has already
  // averaged the entry price for us, so a size change IS a fill.
  useEffect(() => {
    return useTradingStore.subscribe((state, prev) => {
      if (state.allPositions === prev.allPositions) return;
      if (!seededRef.current) return;

      const before = openPositions(prev.allPositions);
      const after = openPositions(state.allPositions);
      const toast = useToastStore.getState().push;

      for (const [key, pos] of after) {
        const wasOpen = before.get(key);
        const side = pos.positionAmt > 0 ? "Long" : "Short";
        const size = Math.abs(pos.positionAmt);
        if (!wasOpen) {
          toast({
            variant: "info",
            title: "Order filled",
            message: `${side} ${size} ${pos.symbol} @ ${formatPrice(pos.entryPrice)}`,
          });
        } else if (Math.abs(pos.positionAmt) > Math.abs(wasOpen.positionAmt) + 1e-12) {
          // Added to an existing position — the entry price is now an average.
          toast({
            variant: "info",
            title: "Order filled — position increased",
            message: `${side} ${size} ${pos.symbol} · avg entry ${formatPrice(pos.entryPrice)}`,
          });
        }
      }

      for (const [key, pos] of before) {
        if (!after.has(key)) {
          toast({
            variant: "info",
            title: "Position closed",
            message: `${pos.symbol}`,
          });
        }
      }
    });
  }, []);
}
