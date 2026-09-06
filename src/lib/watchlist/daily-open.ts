import { fetchKlines } from "@/lib/binance/rest";
import { fetchBybitKlines } from "@/lib/bybit/public";
import { resolveSource } from "@/lib/symbols/source";

interface CacheEntry {
  utcDate: string;
  open: number;
}

/** Module-level so it survives across watchlist remounts within the tab. */
const cache = new Map<string, CacheEntry>();

/** Symbols fetched per `Promise.all` batch, to avoid a full fan-out. */
const CHUNK_SIZE = 8;

/** UTC calendar date (YYYY-MM-DD) — the daily open is constant within one UTC
 *  day, so this is the cache invalidation key. */
export function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function fetchDayOpen(symbol: string): Promise<number | null> {
  try {
    // The current (still-forming) 1d/1D candle's open is the UTC-midnight
    // open, whether it comes from Binance or Bybit.
    const candles =
      resolveSource(symbol).kind === "bybit"
        ? await fetchBybitKlines(symbol, "1d", 1)
        : await fetchKlines(symbol, "1d", 1);
    return candles.at(-1)?.open ?? null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * Daily open (UTC midnight) per symbol — TradingView's "Chg" baseline.
 * Cached until the UTC date rolls over, so repeated calls (e.g. a periodic
 * refresh watching for midnight) only re-fetch symbols whose cached open is
 * missing or dated to a previous UTC day, in small chunks to respect rate
 * limits.
 */
export async function getDailyOpens(symbols: string[]): Promise<Record<string, number>> {
  const today = utcDateKey();
  const stale = symbols.filter((s) => cache.get(s)?.utcDate !== today);

  for (let i = 0; i < stale.length; i += CHUNK_SIZE) {
    const chunk = stale.slice(i, i + CHUNK_SIZE);
    const opens = await Promise.all(chunk.map(fetchDayOpen));
    chunk.forEach((s, idx) => {
      const open = opens[idx];
      if (open !== null) cache.set(s, { utcDate: today, open });
    });
  }

  const result: Record<string, number> = {};
  for (const s of symbols) {
    const entry = cache.get(s);
    if (entry) result[s] = entry.open;
  }
  return result;
}
