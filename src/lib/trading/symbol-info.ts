import { useEffect, useState } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { symbolInfoExchange } from "@/lib/trading/exchange-gate";
import type { SymbolInfo } from "@/lib/binance/trading-types";

/**
 * Client-side cache + React hook around /api/trade/exchange-info. The proxy
 * route already caches the upstream call for 1 h, so this client-side cache
 * primarily avoids re-rendering churn.
 */

const CACHE = new Map<string, SymbolInfo>();
const INFLIGHT = new Map<string, Promise<SymbolInfo>>();

/** Reasonable defaults so the UI is never blocked while the first fetch
 *  resolves. These match BTCUSDT perpetual at the time of writing. */
export const DEFAULT_SYMBOL_INFO: SymbolInfo = {
  symbol: "BTCUSDT",
  status: "TRADING",
  pricePrecision: 2,
  quantityPrecision: 3,
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
};

function cleanSymbol(s: string): string {
  // Drop any BYBIT: prefix and the .P perp suffix.
  const up = s.toUpperCase();
  const bare = up.startsWith("BYBIT:") ? up.slice("BYBIT:".length) : up;
  return bare.replace(/\.P$/, "");
}

export async function getSymbolInfo(
  symbol: string,
  testnet: boolean,
  exchange: string = "binance",
): Promise<SymbolInfo> {
  const sym = cleanSymbol(symbol);
  const cacheKey = `${sym}|${testnet}|${exchange}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;
  const inflight = INFLIGHT.get(cacheKey);
  if (inflight) return inflight;

  const p = (async () => {
    const res = await fetch(
      `/api/trade/exchange-info?symbol=${encodeURIComponent(sym)}&testnet=${testnet}&exchange=${exchange}`,
      { cache: "force-cache" },
    );
    if (!res.ok) throw new Error(`exchange-info ${res.status}`);
    const data = (await res.json()) as SymbolInfo;
    CACHE.set(cacheKey, data);
    return data;
  })();
  INFLIGHT.set(cacheKey, p);
  try {
    return await p;
  } finally {
    INFLIGHT.delete(cacheKey);
  }
}

/** React hook — returns either a real SymbolInfo or the defaults. */
export function useSymbolInfo(symbol: string): SymbolInfo {
  const testnet = useTradingStore((s) => s.testnet);
  const account = useTradingStore((s) => s.exchange);
  // Precision has to describe the venue the *symbol* comes from, not the venue
  // the account is on: rounding a Bybit price to Binance's tick size produces
  // a price the panel shows and the exchange won't take. (`PriceChart` already
  // resolves it this way when it calls `getSymbolInfo` directly.)
  const exchange = symbolInfoExchange(symbol, account);
  const [info, setInfo] = useState<SymbolInfo>(() => {
    const cached = CACHE.get(`${cleanSymbol(symbol)}|${testnet}|${exchange}`);
    return cached ?? { ...DEFAULT_SYMBOL_INFO, symbol: cleanSymbol(symbol) };
  });

  useEffect(() => {
    let cancelled = false;
    void getSymbolInfo(symbol, testnet, exchange)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, testnet, exchange]);

  return info;
}
