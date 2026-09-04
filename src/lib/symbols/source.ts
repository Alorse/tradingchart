import { lookupCatalog, type SourceKind, type SymbolEntry } from "./catalog";
import { hasBybitPrefix, stripExchangePrefix } from "./prefix";
import { isSyntheticExpression } from "@/lib/binance/synthetic";

export type ResolvedSource =
  | { kind: "binance"; symbol: string }
  | { kind: "bybit"; providerSymbol: string; entry: SymbolEntry }
  | { kind: "synthetic"; expression: string }
  | { kind: "yahoo"; providerSymbol: string; entry: SymbolEntry }
  | { kind: "fred"; providerSymbol: string; entry: SymbolEntry }
  | { kind: "coingecko"; providerSymbol: string; entry: SymbolEntry };

/**
 * Decide which data provider to use for a given ticker.
 *
 * Order of resolution:
 *   1. Synthetic expressions (contain operators + at least one symbol token)
 *   2. Explicit catalog entry (stocks, indices, futures, dominances, FRED)
 *   3. Default fallback: Binance spot/perp
 */
export function resolveSource(rawSymbol: string): ResolvedSource {
  const s = rawSymbol.trim().toUpperCase();

  // Explicit `BYBIT:` prefix always routes to Bybit data (works even before the
  // dynamic catalog has loaded, e.g. right after a reload).
  if (hasBybitPrefix(s)) {
    const providerSymbol = stripExchangePrefix(s).replace(/\.P$/, "");
    const entry: SymbolEntry = {
      ticker: s,
      providerSymbol,
      source: "bybit",
      category: "Crypto",
      description: `${providerSymbol} Perpetual · Bybit`,
    };
    return { kind: "bybit", providerSymbol, entry };
  }

  if (isSyntheticExpression(s)) return { kind: "synthetic", expression: s };

  const entry = lookupCatalog(s);
  if (entry) {
    switch (entry.source) {
      case "yahoo":
        return { kind: "yahoo", providerSymbol: entry.providerSymbol, entry };
      case "fred":
        return { kind: "fred", providerSymbol: entry.providerSymbol, entry };
      case "coingecko":
        return { kind: "coingecko", providerSymbol: entry.providerSymbol, entry };
      case "bybit":
        return { kind: "bybit", providerSymbol: entry.providerSymbol, entry };
      case "binance":
        return { kind: "binance", symbol: entry.providerSymbol };
    }
  }
  return { kind: "binance", symbol: s };
}

/** Convenience: return just the source kind label. */
export function sourceKindOf(rawSymbol: string): SourceKind | "synthetic" {
  return resolveSource(rawSymbol).kind;
}

/**
 * Display name per data source. Lives here rather than in `ExchangeLogo` so the
 * venue badge and any text that names the venue (the bottom stats bar) can't
 * drift apart — and so a non-component can read it.
 */
export const VENUE_LABEL: Record<SourceKind | "synthetic", string> = {
  binance: "Binance",
  bybit: "Bybit",
  yahoo: "Yahoo Finance",
  fred: "FRED",
  coingecko: "CoinGecko",
  synthetic: "Synthetic",
};

/**
 * Whether a source pushes updates over a WebSocket. The others are REST-polled
 * and, in Yahoo's case, quoted on a delay — so nothing should label them "Live".
 * Synthetic counts: its legs stream from Binance.
 */
export function isLiveSource(kind: SourceKind | "synthetic"): boolean {
  return kind === "binance" || kind === "bybit" || kind === "synthetic";
}
