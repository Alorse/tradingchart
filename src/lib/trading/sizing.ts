import type { SizingMode, SlMode } from "@/lib/binance/trading-types";

/**
 * Pure conversions between the five sizing modes shown in the Order panel
 * (Amount, Margin USD, % balance, Risk USD, Risk % balance). Single source of
 * truth is `qty` (base asset); every other display value is derived.
 */

export interface SizingCtx {
  /** Entry price used to convert notional <-> qty. For LIMIT this is the
   *  limit price; for MARKET it's the current best ask/bid. */
  entry: number;
  /** Stop-loss price. Required for Risk USD / Risk % modes; null otherwise. */
  sl: number | null;
  leverage: number;
  /** Available USD (quote-asset) balance for % balance modes. */
  balanceUsd: number;
  tickSize: number;
  stepSize: number;
}

/** Round `qty` down to the nearest exchange step size. */
export function roundToStep(qty: number, stepSize: number): number {
  if (!isFinite(qty) || qty <= 0 || stepSize <= 0) return 0;
  return Math.floor(qty / stepSize) * stepSize;
}

/** Round `price` to the nearest tick (banker's rounding). */
export function roundToTick(price: number, tickSize: number): number {
  if (!isFinite(price) || price <= 0 || tickSize <= 0) return price;
  return Math.round(price / tickSize) * tickSize;
}

/** Whole-tick distance between two prices. Signed. */
export function ticksBetween(a: number, b: number, tickSize: number): number {
  if (tickSize <= 0) return 0;
  return Math.round((b - a) / tickSize);
}

/** Margin (USD) locked to hold `qty` at `price` on `leverage`x. The context-free
 *  primitive, so the paper engine can size a fill without fabricating a
 *  `SizingCtx` out of four fields it has no use for. */
export function marginFor(qty: number, price: number, leverage: number): number {
  if (leverage <= 0) return 0;
  return (qty * price) / leverage;
}

/** Margin (USD) required to open `qty` at `entry` at `leverage` x. */
export function marginUsdFromQty(qty: number, ctx: SizingCtx): number {
  return marginFor(qty, ctx.entry, ctx.leverage);
}

export function qtyFromMarginUsd(marginUsd: number, ctx: SizingCtx): number {
  if (ctx.entry <= 0) return 0;
  return (marginUsd * ctx.leverage) / ctx.entry;
}

export function pctBalanceFromQty(qty: number, ctx: SizingCtx): number {
  if (ctx.balanceUsd <= 0) return 0;
  return (marginUsdFromQty(qty, ctx) / ctx.balanceUsd) * 100;
}

export function qtyFromPctBalance(pct: number, ctx: SizingCtx): number {
  const margin = (ctx.balanceUsd * pct) / 100;
  return qtyFromMarginUsd(margin, ctx);
}

/** USD lost if the SL hits (assumes qty in base, SL in quote). */
export function riskUsdFromQty(qty: number, ctx: SizingCtx): number {
  if (ctx.sl === null) return 0;
  return Math.abs(ctx.entry - ctx.sl) * qty;
}

export function qtyFromRiskUsd(riskUsd: number, ctx: SizingCtx): number {
  if (ctx.sl === null) return NaN;
  const dist = Math.abs(ctx.entry - ctx.sl);
  if (dist <= 0) return NaN;
  return riskUsd / dist;
}

export function riskPctFromQty(qty: number, ctx: SizingCtx): number {
  if (ctx.balanceUsd <= 0) return 0;
  return (riskUsdFromQty(qty, ctx) / ctx.balanceUsd) * 100;
}

export function qtyFromRiskPct(pct: number, ctx: SizingCtx): number {
  const riskUsd = (ctx.balanceUsd * pct) / 100;
  return qtyFromRiskUsd(riskUsd, ctx);
}

/** Dispatch: given the active sizing input, produce the canonical qty (base). */
export function sizingToQty(
  mode: SizingMode,
  value: number,
  ctx: SizingCtx,
): number {
  if (!isFinite(value) || value <= 0) return 0;
  let raw = 0;
  switch (mode) {
    case "AMOUNT":      raw = value; break;
    case "MARGIN_USD":  raw = qtyFromMarginUsd(value, ctx); break;
    case "PCT_BALANCE": raw = qtyFromPctBalance(value, ctx); break;
    case "RISK_USD":    raw = qtyFromRiskUsd(value, ctx); break;
    case "RISK_PCT":    raw = qtyFromRiskPct(value, ctx); break;
  }
  return roundToStep(raw, ctx.stepSize);
}

/** Dispatch: given canonical qty, produce a snapshot for all modes. */
export function qtyToSizings(
  qty: number,
  ctx: SizingCtx,
): Record<SizingMode, number> {
  return {
    AMOUNT:      qty,
    MARGIN_USD:  marginUsdFromQty(qty, ctx),
    PCT_BALANCE: pctBalanceFromQty(qty, ctx),
    RISK_USD:    riskUsdFromQty(qty, ctx),
    RISK_PCT:    riskPctFromQty(qty, ctx),
  };
}

/**
 * P&L in quote currency (USD) if the position exits at `exit`. Signed: a
 * positive result is a gain, whichever way the position points.
 *
 * The direction matters and can't be shortcut with `Math.abs` plus a fixed
 * sign per bracket kind. A stop trailed past the entry — above it on a long,
 * below it on a short — no longer caps a loss, it locks in a gain, and the
 * number has to say so. The same holds the other way for a take-profit dragged
 * to the wrong side of the entry.
 */
export function pnlAtExit(
  entry: number,
  exit: number,
  qty: number,
  side: "BUY" | "SELL",
): number {
  if (!isFinite(entry) || !isFinite(exit) || !isFinite(qty)) return 0;
  return (exit - entry) * qty * (side === "BUY" ? 1 : -1);
}

/** Reward-to-risk for the current entry / sl / tp triplet. Returns 0 if
 *  either side is missing or risk is zero. */
export function rrRatio(
  entry: number,
  sl: number | null,
  tp: number | null,
): number {
  if (sl === null || tp === null) return 0;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk <= 0) return 0;
  return reward / risk;
}

/** True if a mode depends on the SL price; used to force the SL toggle on. */
export function modeRequiresSl(mode: SizingMode): boolean {
  return mode === "RISK_USD" || mode === "RISK_PCT";
}

/* ── Stop-loss input modes ─────────────────────────────────────────────────
 * The canonical stop value is always a PRICE; these convert to/from the unit
 * the user is typing in. A stop sits below the entry for a long and above it
 * for a short, so the side decides the direction of the offset.
 *
 * Risk is intentionally not a unit here — see `SlMode`.
 */

export interface SlCtx {
  entry: number;
  side: "BUY" | "SELL";
}

/** Signed direction from entry to the stop: -1 for a long, +1 for a short. */
function slDirection(side: "BUY" | "SELL"): number {
  return side === "BUY" ? -1 : 1;
}

/** Turn a value typed in `mode` into the canonical stop price. */
export function slInputToPrice(mode: SlMode, value: number, ctx: SlCtx): number {
  if (!isFinite(value) || value <= 0) return NaN;
  if (mode === "PRICE") return value;
  if (ctx.entry <= 0) return NaN;
  const distance = (ctx.entry * value) / 100;
  const price = ctx.entry + slDirection(ctx.side) * distance;
  return price > 0 ? price : NaN;
}

/** Express a canonical stop price in `mode`'s unit (0 when not computable). */
export function slPriceToInput(mode: SlMode, slPrice: number, ctx: SlCtx): number {
  if (!isFinite(slPrice) || slPrice <= 0) return 0;
  if (mode === "PRICE") return slPrice;
  if (ctx.entry <= 0) return 0;
  return (Math.abs(ctx.entry - slPrice) / ctx.entry) * 100;
}
