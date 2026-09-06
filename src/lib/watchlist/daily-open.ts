import { fetchCandles } from "@/lib/data/fetch";

/** Module-level so it survives across watchlist remounts within the tab. */
const cache = new Map<string, number>();
/** The whole cache goes stale at the same instant — the UTC date it was built for. */
let cacheDate = "";

/** UTC calendar date (YYYY-MM-DD) — the daily open is constant within one UTC
 *  day, so this is the cache invalidation key. */
export function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Move since the UTC-midnight open, or null until both sides are known. */
export function dailyChange(
  price: number | undefined,
  open: number | undefined,
): { amount: number; pct: number; price: number } | null {
  if (price === undefined || !open) return null;
  return { amount: price - open, pct: ((price - open) / open) * 100, price };
}

async function fetchDayOpen(symbol: string): Promise<number | null> {
  try {
    // The current (still-forming) 1d candle's open is the UTC-midnight open.
    const candles = await fetchCandles(symbol, "1d", 1);
    return candles.at(-1)?.open ?? null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** Daily open (UTC midnight) per symbol — TradingView's "Chg" baseline. */
export async function getDailyOpens(symbols: string[]): Promise<Record<string, number>> {
  const today = utcDateKey();
  if (cacheDate !== today) {
    cache.clear();
    cacheDate = today;
  }

  const stale = symbols.filter((s) => !cache.has(s));
  const opens = await Promise.all(stale.map(fetchDayOpen));
  stale.forEach((s, i) => {
    const open = opens[i];
    if (open !== null) cache.set(s, open);
  });

  const result: Record<string, number> = {};
  for (const s of symbols) {
    const open = cache.get(s);
    if (open !== undefined) result[s] = open;
  }
  return result;
}
