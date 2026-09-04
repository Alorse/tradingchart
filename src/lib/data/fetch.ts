import type { Candle, Ticker24h, Timeframe } from "@/lib/binance/types";
import { fetchKlines, fetchTicker24h } from "@/lib/binance/rest";
import { fetchSyntheticKlines } from "@/lib/binance/synthetic";
import { fetchYahooCandles } from "@/lib/providers/yahoo";
import { fetchFredCandles } from "@/lib/providers/fred";
import { fetchCoinGeckoCandles } from "@/lib/providers/coingecko";
import { fetchBybitKlines, fetchBybitStats24h } from "@/lib/bybit/public";
import { resolveSource } from "@/lib/symbols/source";

/**
 * One-shot candle fetcher that auto-dispatches to the correct provider.
 *
 * The PriceChart should call this instead of the Binance-specific helpers so
 * stocks, futures, indices, dominances, and FRED macro series all share the
 * same loading path.
 */
export async function fetchCandles(
  symbol: string,
  interval: Timeframe,
  limit = 1000,
): Promise<Candle[]> {
  const src = resolveSource(symbol);
  switch (src.kind) {
    case "synthetic":
      return fetchSyntheticKlines(src.expression, interval, limit);
    case "yahoo":
      return fetchYahooCandles(src.providerSymbol, interval);
    case "fred":
      return fetchFredCandles(src.providerSymbol);
    case "coingecko":
      return fetchCoinGeckoCandles(src.providerSymbol, interval);
    case "bybit":
      return fetchBybitKlines(src.providerSymbol, interval, limit);
    case "binance":
      return fetchKlines(src.symbol, interval, limit);
  }
}

/**
 * Page older candles ending strictly before `beforeTimeSec`. Used by bar replay
 * to give the playhead room behind the initially-loaded window.
 *
 * Only Binance sources support paging (the app's focus); other providers return
 * `[]`, so replay simply runs on whatever candles are already loaded.
 */
export async function fetchOlderCandles(
  symbol: string,
  interval: Timeframe,
  beforeTimeSec: number,
  limit = 1000,
): Promise<Candle[]> {
  const src = resolveSource(symbol);
  // endTime is exclusive-ish; step back 1ms so we don't refetch the boundary bar.
  if (src.kind === "binance") {
    const candles = await fetchKlines(src.symbol, interval, limit, beforeTimeSec * 1000 - 1);
    return candles.filter((c) => c.time < beforeTimeSec);
  }
  if (src.kind === "bybit") {
    const candles = await fetchBybitKlines(src.providerSymbol, interval, limit, beforeTimeSec * 1000 - 1);
    return candles.filter((c) => c.time < beforeTimeSec);
  }
  return [];
}

/**
 * 24h stats for the charted symbol, dispatched the same way candles are.
 *
 * Returns `null` for the sources that have no 24h rolling window to report:
 * Yahoo/FRED/CoinGecko serve daily-or-coarser series, and a synthetic spread is
 * an expression with no venue-published volume. Callers should render "no
 * stats", not zeros — and above all must not fall back to the Binance endpoint,
 * which would answer for a *different* instrument that happens to share a
 * ticker.
 */
export async function fetchStats24h(symbol: string): Promise<Ticker24h | null> {
  const src = resolveSource(symbol);
  switch (src.kind) {
    case "binance":
      return fetchTicker24h(src.symbol);
    case "bybit":
      return fetchBybitStats24h(src.providerSymbol);
    case "synthetic":
    case "yahoo":
    case "fred":
    case "coingecko":
      return null;
  }
}
