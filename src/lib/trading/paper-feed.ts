import { sourceKindOf } from "@/lib/symbols/source";
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
 */
export function paperFeedExposure(account: PaperAccount): PaperFeedExposure {
  const symbols = new Set<string>();
  for (const p of account.positions) {
    if (typeof p.feedSymbol === "string" && p.feedSymbol) symbols.add(p.feedSymbol);
  }
  for (const o of account.orders) {
    if (o.status === "NEW" && typeof o.feedSymbol === "string" && o.feedSymbol) {
      symbols.add(o.feedSymbol);
    }
  }

  const exposure: PaperFeedExposure = { binance: [], bybit: [] };
  for (const s of symbols) {
    const source = paperFeedSource(s);
    if (source) exposure[source].push(s);
  }
  return exposure;
}
