import type { SizingMode, SlMode } from "@/lib/binance/trading-types";
import { cleanSym, isPerp } from "@/lib/binance/rest";
import type {
  LimitOrderRequest,
  MarketOrderRequest,
  PaperOrderType,
  PaperSide,
} from "@/lib/trading/paper-engine";

/**
 * Local form state for `PaperOrderPanel` — the same shape of fields as the
 * live `OrderForm` (`trading-store.ts`) restricted to what the paper engine
 * actually understands: no stop orders, no time-in-force, no reduce-only
 * (see `paper-engine.ts`'s header comment on its deliberate simplifications).
 * Kept as component-local `useState` rather than a store slice — nothing
 * outside the panel needs to read it (unlike the live form, which
 * `OrderLinesLayer` also mirrors as a chart preview).
 */
export interface PaperOrderForm {
  side: PaperSide;
  type: PaperOrderType;
  /** LIMIT price. Ignored for MARKET. */
  price: string;
  /** Canonical quantity in base asset. */
  qty: string;
  sizingMode: SizingMode;
  sizingInput: string;
  slEnabled: boolean;
  sl: string;
  slMode: SlMode;
  tpEnabled: boolean;
  tp: string;
  leverage: number;
}

export function defaultPaperOrderForm(defaultLeverage: number): PaperOrderForm {
  return {
    side: "BUY",
    type: "MARKET",
    price: "",
    qty: "",
    sizingMode: "AMOUNT",
    sizingInput: "",
    slEnabled: false,
    sl: "",
    slMode: "PRICE",
    tpEnabled: false,
    tp: "",
    leverage: defaultLeverage,
  };
}

/** True once the form has enough to submit — qty for every type, plus a
 *  positive limit price when the order rests instead of filling immediately. */
export function isPaperOrderReady(form: PaperOrderForm): boolean {
  const qty = parseFloat(form.qty);
  if (!isFinite(qty) || qty <= 0) return false;
  if (form.type === "LIMIT") {
    const price = parseFloat(form.price);
    if (!isFinite(price) || price <= 0) return false;
  }
  return true;
}

function bracket(enabled: boolean, value: string): number | null {
  if (!enabled) return null;
  const n = parseFloat(value);
  return isFinite(n) && n > 0 ? n : null;
}

/**
 * Builds the engine request from the raw chart symbol — `symbol` here may
 * carry the `.P` perp suffix and/or a `BYBIT:` exchange prefix (see
 * CLAUDE.md's "Symbol identity"). `isPerp` needs to see the undecorated
 * symbol (it's what the suffix means), so it runs before `cleanSym` strips
 * it; the request itself stores the cleaned symbol, the one canonical key
 * `evaluateTick`, the store's positions/orders and the chart's price-line
 * layer all key off of (adversarial review finding 3).
 *
 * Leverage only means anything for a perp — `LeverageSlider` is hidden for
 * spot symbols, so a spot order forces 1x rather than silently inheriting
 * whatever `form.leverage` was left at (adversarial review finding 8).
 */
export function paperFormToMarketRequest(
  form: PaperOrderForm,
  symbol: string,
): MarketOrderRequest {
  const perp = isPerp(symbol);
  return {
    symbol: cleanSym(symbol),
    side: form.side,
    qty: parseFloat(form.qty) || 0,
    leverage: perp ? form.leverage : 1,
    tp: bracket(form.tpEnabled, form.tp),
    sl: bracket(form.slEnabled, form.sl),
  };
}

export function paperFormToLimitRequest(
  form: PaperOrderForm,
  symbol: string,
): LimitOrderRequest {
  return {
    ...paperFormToMarketRequest(form, symbol),
    price: parseFloat(form.price) || 0,
  };
}

/**
 * Mirrors the engine's own bracket-side rule (`normalizeBrackets` in
 * paper-engine.ts: long TP > price > SL, short the other way) so the panel
 * can block a submission the engine would otherwise silently drop instead of
 * leaving the user to notice a missing TP/SL only after the fill (adversarial
 * review finding 7). `null` means the brackets (if any) are fine to submit.
 */
export function invalidBracketReason(form: PaperOrderForm, referencePrice: number): string | null {
  if (!isFinite(referencePrice) || referencePrice <= 0) return null;
  const long = form.side === "BUY";
  const tp = bracket(form.tpEnabled, form.tp);
  const sl = bracket(form.slEnabled, form.sl);
  if (tp !== null && (long ? tp <= referencePrice : tp >= referencePrice)) {
    return `Take-profit must be ${long ? "above" : "below"} the current price`;
  }
  if (sl !== null && (long ? sl >= referencePrice : sl <= referencePrice)) {
    return `Stop-loss must be ${long ? "below" : "above"} the current price`;
  }
  return null;
}
