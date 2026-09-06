import { stripExchangePrefix } from "@/lib/symbols/prefix";

/**
 * The key the paper engine stores a position or order under, and the key every
 * lookup against it has to use — the paper counterpart of `cleanSym` for the
 * real exchanges.
 *
 * Strips the `BYBIT:` exchange qualifier but **keeps** `.P`: a ticker charted
 * from two venues (`SOLUSDT.P` and `BYBIT:SOLUSDT.P`) is one instrument and
 * should net into one position, whereas spot and perp of the same ticker
 * (`BTCUSDT` and `BTCUSDT.P`) are different instruments with different prices
 * and no netting relationship on any real venue — netting those silently
 * closed them out against each other.
 *
 * `cleanSym` is deliberately *not* what's wanted here: it drops `.P` too,
 * which would collapse that second pair.
 *
 * A dependency-free leaf over `prefix.ts`, so the pure engine-side modules and
 * the React components can share it without either importing the other.
 */
export function paperSymbolKey(symbol: string): string {
  return stripExchangePrefix(symbol);
}
