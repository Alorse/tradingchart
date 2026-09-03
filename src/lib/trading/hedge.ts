import type { OrderSide } from "@/lib/binance/trading-types";

/**
 * Which Bybit hedge-mode slot an order belongs to (1 long, 2 short).
 *
 * The mapping is *not* just "BUY is long": a reduceOnly order points the
 * opposite way to the position it serves, so a reduceOnly SELL is the long
 * position's stop, not a short. Getting this backwards sends an order to the
 * wrong hedge slot, where Bybit either rejects it (`position idx not match
 * position mode`) or, worse, opens exposure on the other side.
 *
 * Only meaningful on hedge-mode accounts; one-way accounts use index 0.
 */
export function hedgePositionIdx(side: OrderSide, reduceOnly: boolean): 1 | 2 {
  const long = reduceOnly ? side === "SELL" : side === "BUY";
  return long ? 1 : 2;
}

/**
 * Quantity still working on an order — what a cancel/replace has to re-post.
 *
 * Reposting `origQty` on a partially-filled order stacks the already-filled
 * portion on top of the new one: nudging the price of a 1 BTC order that is
 * 40% filled would leave 0.4 filled plus a fresh 1.0 working, i.e. up to 1.4
 * BTC of exposure against 1.0 intended.
 */
export function remainingQty(origQty: number, executedQty: number): number {
  const remaining = origQty - (Number.isFinite(executedQty) ? executedQty : 0);
  return remaining > 0 ? remaining : 0;
}
