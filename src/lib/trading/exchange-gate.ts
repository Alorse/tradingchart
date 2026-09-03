import { resolveSource } from "@/lib/symbols/source";
import type { Exchange } from "@/lib/binance/trading-types";

/**
 * Venue gating for the **write** path (placing orders).
 *
 * Account data always comes from the single connected exchange, but the chart
 * may be showing a different venue's symbol. The read paths already refuse to
 * overlay account state on a foreign chart (`OrderLinesLayer`, the watchlist
 * badges) — this is the same check for the side that spends money.
 *
 * Two chart symbols can reduce to the same `cleanSym` (`SOLUSDT.P` and
 * `BYBIT:SOLUSDT.P`), so "the ticker exists on the connected exchange" is not
 * enough: an order built from Bybit's book would otherwise be submitted to
 * Binance's, at a price and tick size that belong to the other venue.
 *
 * Deliberately fails closed. If the dynamic Bybit registry hasn't loaded yet, a
 * bare Bybit ticker still resolves to Binance and gets blocked with an explicit
 * message — refusing an order the user can retry is the safe direction, sending
 * it to the wrong venue is not.
 */

export type TradeGate =
  | { ok: true }
  | { ok: false; reason: string };

/** Source kinds that can actually accept an order through `/api/trade/*`. */
const TRADABLE_KINDS = new Set<string>(["binance", "bybit"]);

const VENUE_LABEL: Record<string, string> = {
  binance: "Binance",
  bybit: "Bybit",
  yahoo: "Yahoo",
  fred: "FRED",
  coingecko: "CoinGecko",
  synthetic: "a synthetic expression",
};

function label(kind: string): string {
  return VENUE_LABEL[kind] ?? kind;
}

/**
 * Whether an order for `symbol` may be submitted to `exchange`, i.e. whether
 * the chart's data source and the connected trading account are the same venue.
 */
export function tradeGate(symbol: string, exchange: Exchange): TradeGate {
  const kind = resolveSource(symbol).kind;

  if (!TRADABLE_KINDS.has(kind)) {
    return {
      ok: false,
      reason: `${symbol} is charted from ${label(kind)} and can't be traded.`,
    };
  }

  if (kind !== exchange) {
    return {
      ok: false,
      reason:
        `${symbol} is charted from ${label(kind)}, but the connected account is ` +
        `${label(exchange)}. Switch the account or chart the ${label(exchange)} symbol.`,
    };
  }

  return { ok: true };
}

/**
 * Which venue's `exchangeInfo` describes `symbol`'s tick/lot precision.
 *
 * This has to follow the *chart symbol's* data source, not the connected
 * account: rounding a Bybit price to Binance's tick size produces a price the
 * order form shows and the exchange rejects (or silently re-rounds). Falls back
 * to the connected account for symbols that have no exchange of their own
 * (stocks, macro series, synthetics), where the value is unused anyway.
 */
export function symbolInfoExchange(symbol: string, fallback: Exchange): Exchange {
  const kind = resolveSource(symbol).kind;
  if (kind === "binance" || kind === "bybit") return kind;
  return fallback;
}
