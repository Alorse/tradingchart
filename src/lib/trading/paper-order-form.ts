import type { SizingMode, SlMode } from "@/lib/binance/trading-types";
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

export function paperFormToMarketRequest(
  form: PaperOrderForm,
  symbol: string,
): MarketOrderRequest {
  return {
    symbol,
    side: form.side,
    qty: parseFloat(form.qty) || 0,
    leverage: form.leverage,
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
