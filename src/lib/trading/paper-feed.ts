import { sourceKindOf } from "@/lib/symbols/source";
import { cleanSym } from "@/lib/binance/rest";
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
 * Keyed by `cleanSym` (bare exchange symbol) rather than the decorated
 * feedSymbol itself: `evaluateTick` (see `paper-trading-store.ts`) matches
 * positions/orders by their *bare* `symbol`, so `BYBIT:SOLUSDT.P` and
 * `SOLUSDT.P` — two different feeds — would otherwise both drive the same
 * `SOLUSDT` mark, and whichever socket ticks last silently owns it (a Bybit
 * position priced off Binance spot). Only one decorated feedSymbol survives
 * per bare symbol, so at most one venue is ever subscribed for it — a
 * position's feed wins over a resting order's (positions are scanned first
 * and claim the bare symbol before orders are considered).
 */
export function paperFeedExposure(account: PaperAccount): PaperFeedExposure {
  const owners = new Map<string, string>();
  for (const p of account.positions) {
    if (typeof p.feedSymbol === "string" && p.feedSymbol) {
      const bare = cleanSym(p.feedSymbol);
      if (!owners.has(bare)) owners.set(bare, p.feedSymbol);
    }
  }
  for (const o of account.orders) {
    if (o.status === "NEW" && typeof o.feedSymbol === "string" && o.feedSymbol) {
      const bare = cleanSym(o.feedSymbol);
      if (!owners.has(bare)) owners.set(bare, o.feedSymbol);
    }
  }

  const exposure: PaperFeedExposure = { binance: [], bybit: [] };
  for (const feedSymbol of owners.values()) {
    const source = paperFeedSource(feedSymbol);
    if (source) exposure[source].push(feedSymbol);
  }
  return exposure;
}
