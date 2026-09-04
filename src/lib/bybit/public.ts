import type { Candle, Ticker24h, Timeframe } from "@/lib/binance/types";
import { stripExchangePrefix } from "@/lib/symbols/prefix";

/**
 * Bybit public market data (no credentials). Used to chart Bybit linear perps
 * that aren't on Binance. Mirrors the Binance REST helpers' shapes so the
 * generic fetchCandles dispatcher can treat it like any other source.
 */

const BASE = "https://api.bybit.com";

/** Map the app's Timeframe to Bybit's kline interval codes. Bybit has no 8h/3d,
 *  so those degrade to the nearest supported lower interval. */
const INTERVAL: Record<Timeframe, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "8h": "240",
  "12h": "720",
  "1d": "D",
  "3d": "D",
  "1w": "W",
  "1M": "M",
};

export function bybitInterval(tf: Timeframe): string {
  return INTERVAL[tf] ?? "60";
}

/** Raw Bybit symbol (e.g. BTCUSDT): drop any `BYBIT:` prefix and `.P` suffix. */
export function bybitSymbol(s: string): string {
  return stripExchangePrefix(s).replace(/\.P$/, "");
}

interface BybitKlineResp {
  retCode: number;
  retMsg: string;
  result: { list: string[][] };
}

/**
 * Fetch linear-perp klines. Bybit returns rows newest-first as
 * [start, open, high, low, close, volume, turnover]; we reverse to oldest-first.
 * `endMs` (exclusive-ish) pages older history for replay.
 */
export async function fetchBybitKlines(
  symbol: string,
  interval: Timeframe,
  limit = 1000,
  endMs?: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    category: "linear",
    symbol: bybitSymbol(symbol),
    interval: bybitInterval(interval),
    limit: String(Math.min(limit, 1000)),
  });
  if (endMs) params.set("end", String(endMs));
  const res = await fetch(`${BASE}/v5/market/kline?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`bybit kline ${res.status}`);
  const data = (await res.json()) as BybitKlineResp;
  if (data.retCode !== 0) throw new Error(data.retMsg || "bybit kline error");
  return (data.result.list ?? [])
    .map((r) => ({
      time: Math.floor(parseInt(r[0], 10) / 1000),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }))
    .sort((a, b) => a.time - b.time);
}

export interface BybitPerpSymbol {
  /** Ticker as shown to the user, with the ".P" perp suffix (e.g. BTCUSDT.P). */
  ticker: string;
  /** Raw Bybit symbol used in API calls (e.g. BTCUSDT). */
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
}

interface InstrumentsResp {
  retCode: number;
  retMsg: string;
  result: {
    list: { symbol: string; status: string; baseCoin: string; quoteCoin: string; contractType: string }[];
    nextPageCursor?: string;
  };
}

export interface BybitTicker24h {
  /** Ticker with the ".P" perp suffix, matching how watchlists store it. */
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
}

interface TickersResp {
  retCode: number;
  retMsg: string;
  result: { list: { symbol: string; lastPrice: string; price24hPcnt: string }[] };
}

/**
 * 24h snapshot for a set of Bybit linear perps. Fetches the whole linear ticker
 * list in one call and filters to the requested symbols (one round-trip covers
 * any watchlist size). Input/return symbols carry the ".P" suffix.
 */
export async function fetchBybitTickers24h(symbols: string[]): Promise<BybitTicker24h[]> {
  if (symbols.length === 0) return [];
  // Map each bare Bybit symbol back to the caller's exact ticker (which may
  // carry a BYBIT: prefix), so watchlist rows keyed by that ticker match.
  const bareToInput = new Map(symbols.map((s) => [bybitSymbol(s), s]));
  const res = await fetch(`${BASE}/v5/market/tickers?category=linear`, { cache: "no-store" });
  if (!res.ok) throw new Error(`bybit tickers ${res.status}`);
  const data = (await res.json()) as TickersResp;
  if (data.retCode !== 0) throw new Error(data.retMsg || "bybit tickers error");
  return (data.result.list ?? [])
    .filter((t) => bareToInput.has(t.symbol))
    .map((t) => ({
      symbol: bareToInput.get(t.symbol) as string,
      lastPrice: parseFloat(t.lastPrice),
      priceChangePercent: parseFloat(t.price24hPcnt) * 100,
    }));
}

/** Full 24h stats for ONE linear perp, in the shared `Ticker24h` shape. */
export async function fetchBybitStats24h(symbol: string): Promise<Ticker24h> {
  // Query the single symbol rather than reusing `fetchBybitTickers24h`, which
  // pulls the entire linear ticker list — fine amortised across a watchlist,
  // wasteful for the one charted symbol on a 5s poll.
  const bare = bybitSymbol(symbol);
  const res = await fetch(`${BASE}/v5/market/tickers?category=linear&symbol=${bare}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`bybit ticker ${res.status}`);
  const data = (await res.json()) as StatsResp;
  if (data.retCode !== 0) throw new Error(data.retMsg || "bybit ticker error");
  const t = data.result.list?.[0];
  if (!t) throw new Error(`bybit ticker: no data for ${bare}`);
  const last = parseFloat(t.lastPrice);
  const prev = parseFloat(t.prevPrice24h);
  return {
    symbol,
    lastPrice: last,
    priceChange: last - prev,
    // Bybit sends a fraction (0.0123), not a percentage.
    priceChangePercent: parseFloat(t.price24hPcnt) * 100,
    highPrice: parseFloat(t.highPrice24h),
    lowPrice: parseFloat(t.lowPrice24h),
    volume: parseFloat(t.volume24h),
    quoteVolume: parseFloat(t.turnover24h),
  };
}

interface StatsResp {
  retCode: number;
  retMsg: string;
  result: {
    list?: {
      symbol: string;
      lastPrice: string;
      prevPrice24h: string;
      price24hPcnt: string;
      highPrice24h: string;
      lowPrice24h: string;
      volume24h: string;
      turnover24h: string;
    }[];
  };
}

let cachedPerps: BybitPerpSymbol[] | null = null;

/**
 * Fetch the full Bybit linear USDT-perp universe (paged). Cached for the session.
 */
export async function fetchBybitPerpSymbols(): Promise<BybitPerpSymbol[]> {
  if (cachedPerps) return cachedPerps;
  const out: BybitPerpSymbol[] = [];
  let cursor: string | undefined;
  // A handful of pages covers Bybit's ~600 linear perps (1000/page).
  for (let i = 0; i < 5; i++) {
    const params = new URLSearchParams({ category: "linear", limit: "1000" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${BASE}/v5/market/instruments-info?${params}`, {
      cache: "force-cache",
    });
    if (!res.ok) throw new Error(`bybit instruments ${res.status}`);
    const data = (await res.json()) as InstrumentsResp;
    if (data.retCode !== 0) throw new Error(data.retMsg || "bybit instruments error");
    for (const s of data.result.list ?? []) {
      if (s.status !== "Trading" || s.quoteCoin !== "USDT") continue;
      if (s.contractType && s.contractType !== "LinearPerpetual") continue;
      out.push({
        ticker: `${s.symbol}.P`,
        symbol: s.symbol,
        baseCoin: s.baseCoin,
        quoteCoin: s.quoteCoin,
      });
    }
    cursor = data.result.nextPageCursor;
    if (!cursor) break;
  }
  cachedPerps = out;
  return out;
}
