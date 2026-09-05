import { pnlAtExit, rrRatio, ticksBetween } from "@/lib/trading/sizing";

/**
 * Pure sizing/money math for the Long/Short position drawing tools, shared by
 * the renderer (PositionDraw) and the settings dialog. Kept separate from
 * `src/lib/trading/sizing.ts` (which sizes a live order from a chosen mode)
 * because this module answers a different question — "what qty does this
 * drawing's risk+leverage inputs imply" — but reuses that module's
 * `pnlAtExit`/`rrRatio`/`ticksBetween` rather than re-deriving the same P&L,
 * reward:risk and tick math a second time.
 */

export type PositionSide = "long" | "short";

function sideToBuySell(side: PositionSide): "BUY" | "SELL" {
  return side === "long" ? "BUY" : "SELL";
}

/** Resolves the risk budget in quote currency from either a flat amount or a
 *  percentage of account size. Returns 0 for a non-positive/missing risk. */
export function riskSizeFromInputs(
  accountSize: number,
  risk: number,
  riskIsPercent: boolean,
): number {
  if (!isFinite(accountSize) || !isFinite(risk) || risk <= 0) return 0;
  return riskIsPercent ? (accountSize * risk) / 100 : risk;
}

/** Qty implied by risking `riskSize` over the entry→stop distance. */
export function qtyFromRisk(
  entry: number,
  stop: number,
  riskSize: number,
  pointValue = 1,
  lotSize = 1,
): number {
  const priceDist = Math.abs(entry - stop);
  if (!isFinite(priceDist) || priceDist <= 0) return 0;
  if (!isFinite(riskSize) || riskSize <= 0) return 0;
  if (!isFinite(pointValue) || pointValue <= 0) return 0;
  if (!isFinite(lotSize) || lotSize <= 0) return 0;
  return riskSize / (priceDist * pointValue) / lotSize;
}

/** Qty implied by using all of `leverage`x on `accountSize` at `entry`. */
export function qtyFromLeverage(
  entry: number,
  accountSize: number,
  leverage: number,
  pointValue = 1,
  lotSize = 1,
): number {
  if (!isFinite(entry) || entry <= 0) return 0;
  if (!isFinite(accountSize) || accountSize <= 0) return 0;
  if (!isFinite(leverage) || leverage <= 0) return 0;
  if (!isFinite(pointValue) || pointValue <= 0) return 0;
  if (!isFinite(lotSize) || lotSize <= 0) return 0;
  return ((accountSize * leverage) / entry) * pointValue / lotSize;
}

export interface PositionQtyInputs {
  entry: number;
  stop: number;
  accountSize?: number;
  risk?: number;
  riskIsPercent?: boolean;
  leverage?: number;
  /** Contract multiplier; 1 for spot and USDT-margined linear perps
   *  (1 contract = 1 unit of base asset), which is all this app trades. */
  pointValue?: number;
  lotSize?: number;
}

/**
 * qty = min(qty sized off the risk budget, qty sized off max leverage).
 * Returns `null` when `accountSize`/`risk` haven't been entered yet — the
 * caller should hide qty/money stats in that case rather than show a
 * misleading 0. An explicit risk of 0 (vs. unset) still yields a real 0,
 * same as a zero entry/stop distance — both fall out of the divide-by-zero
 * guards in `qtyFromRisk`/`qtyFromLeverage` without special-casing here.
 */
export function positionQty(inputs: PositionQtyInputs): number | null {
  const {
    entry,
    stop,
    accountSize,
    risk,
    riskIsPercent = false,
    leverage,
    pointValue = 1,
    lotSize = 1,
  } = inputs;
  if (accountSize === undefined || risk === undefined) return null;
  const riskSize = riskSizeFromInputs(accountSize, risk, riskIsPercent);
  const qtyRisk = qtyFromRisk(entry, stop, riskSize, pointValue, lotSize);
  const qtyLvg =
    leverage !== undefined && leverage > 0
      ? qtyFromLeverage(entry, accountSize, leverage, pointValue, lotSize)
      : Infinity;
  const qty = Math.min(qtyRisk, qtyLvg);
  return isFinite(qty) ? qty : 0;
}

/** Signed currency P&L if the position exits at `level` with size `qty`. */
export function pnlAtLevel(
  entry: number,
  level: number,
  qty: number,
  side: PositionSide,
  pointValue = 1,
): number {
  return pnlAtExit(entry, level, qty * pointValue, sideToBuySell(side));
}

/** Account balance after the position closes at `level` for `pnl`. */
export function balanceAfter(accountSize: number, pnl: number): number {
  return accountSize + pnl;
}

/** Signed % price offset of `level` from `entry`. */
export function offsetPct(entry: number, level: number): number {
  if (!isFinite(entry) || entry === 0) return 0;
  return ((level - entry) / entry) * 100;
}

/** Signed whole-tick offset of `level` from `entry`. */
export function offsetTicks(entry: number, level: number, tickSize: number): number {
  return ticksBetween(entry, level, tickSize);
}

/** Reward:risk for an entry/stop/target triplet. */
export function rewardRiskRatio(entry: number, stop: number, target: number): number {
  return rrRatio(entry, stop, target);
}

/**
 * Signed price movement in the position's favor — positive means price has
 * moved toward the target. This is the "movement" axis (see CLAUDE.md's
 * direction-vs-movement color rule), not a currency amount; multiply by
 * qty*pointValue (or use `openPnlCurrency`) for the money version.
 */
export function openPnl(entry: number, markPrice: number, side: PositionSide): number {
  if (!isFinite(entry) || !isFinite(markPrice)) return 0;
  return side === "long" ? markPrice - entry : entry - markPrice;
}

/** Signed currency open P&L at the current mark price. */
export function openPnlCurrency(
  entry: number,
  markPrice: number,
  qty: number,
  side: PositionSide,
  pointValue = 1,
): number {
  return pnlAtLevel(entry, markPrice, qty, side, pointValue);
}

const KNOWN_QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "USD"];

/**
 * Best-effort quote currency for a chart symbol, for stats-block labels only
 * (never used in the qty/pnl math above, which is currency-agnostic). Strips
 * the `BYBIT:` exchange prefix and `.P` perp suffix the same way `cleanSym`
 * does, then matches the longest known quote suffix. Falls back to "USDT",
 * this app's near-universal quote asset for tradeable symbols.
 */
export function deriveQuoteCurrency(symbol: string): string {
  const clean = symbol.toUpperCase().replace(/^BYBIT:/, "").replace(/\.P$/, "");
  for (const q of KNOWN_QUOTES) {
    if (clean.length > q.length && clean.endsWith(q)) return q;
  }
  return "USDT";
}
