import { sourceKindOf } from "@/lib/symbols/source";

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
