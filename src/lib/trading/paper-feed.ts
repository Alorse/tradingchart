import { sourceKindOf } from "@/lib/symbols/source";
import { stripExchangePrefix } from "@/lib/symbols/prefix";
import type { PaperAccount } from "./paper-engine";

/**
 * Which live WS feed (if any) can drive the paper engine for `symbol`. Only
 * Binance and Bybit push a live tick stream through this app (see
 * CLAUDE.md's "Data providers" section) — stocks/macro/coingecko are
 * REST-poll only and synthetic expressions have no venue of their own, so a
 * paper position on one of those symbols is priced but never fills or ticks.
 * `null` is the guard the tick-feed hook uses to skip subscribing at all.
 */
export type PaperFeedSource = "binance" | "bybit" | null;

export function paperFeedSource(symbol: string): PaperFeedSource {
  const kind = sourceKindOf(symbol);
  return kind === "binance" || kind === "bybit" ? kind : null;
}

export interface PaperFeedExposure {
  binance: string[];
  bybit: string[];
}

/**
 * Every distinct decorated symbol the account has live exposure to — an open
 * position or a resting order — grouped by which WS singleton serves it. This
 * is what lets a mark keep updating for a position that isn't the currently
 * charted symbol (adversarial re-audit finding 10): the wiring hook
 * subscribes exactly this set instead of only whatever's on the chart.
 *
 * A position/order with no `feedSymbol` (persisted before the field existed,
 * or opened by a direct engine call outside the UI) is skipped rather than
 * guessed at — there's no decorated form to resubscribe with, same as a
 * feedless symbol today. `typeof` guards against a corrupted persisted value
 * of the wrong type reaching `sourceKindOf`, which assumes a string.
 *
 * Keyed by `stripExchangePrefix` rather than the decorated feedSymbol itself,
 * and with the exact same key the engine stores on a position/order (see
 * `paperFormToMarketRequest`): `evaluateTick` (in `paper-trading-store.ts`)
 * matches positions/orders by that key, so `BYBIT:SOLUSDT.P` and `SOLUSDT.P`
 * — one instrument on two venues — must resolve to a single owner, or
 * whichever socket ticks last silently owns the mark (a Bybit position priced
 * off Binance). Only one decorated feedSymbol survives per key, so at most
 * one venue is ever subscribed for it — a position's feed wins over a resting
 * order's (positions are scanned first and claim the key before orders are
 * considered).
 *
 * The `.P` suffix stays *in* the key, since spot and perp are separate
 * instruments with separate positions and separate feeds (holistic review
 * finding 4) — dropping it here would resubscribe only one of the two and
 * leave the other's mark frozen.
 */
export function paperFeedExposure(account: PaperAccount): PaperFeedExposure {
  const owners = new Map<string, string>();
  for (const p of account.positions) {
    if (typeof p.feedSymbol === "string" && p.feedSymbol) {
      const key = stripExchangePrefix(p.feedSymbol);
      if (!owners.has(key)) owners.set(key, p.feedSymbol);
    }
  }
  for (const o of account.orders) {
    if (o.status === "NEW" && typeof o.feedSymbol === "string" && o.feedSymbol) {
      const key = stripExchangePrefix(o.feedSymbol);
      if (!owners.has(key)) owners.set(key, o.feedSymbol);
    }
  }

  const exposure: PaperFeedExposure = { binance: [], bybit: [] };
  for (const feedSymbol of owners.values()) {
    const source = paperFeedSource(feedSymbol);
    if (source) exposure[source].push(feedSymbol);
  }
  return exposure;
}
