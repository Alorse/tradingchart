export type OrderSide = "BUY" | "SELL";
export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP"
  | "STOP_MARKET"
  | "STOP_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_MARKET";
export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTX";

export interface Order {
  orderId: number | string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: number;
  origQty: number;
  executedQty: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  time: number;
  updateTime: number;
  reduceOnly?: boolean;
  isPerp: boolean;
  /** Bybit hedge-mode slot this order belongs to (0 one-way, 1 long, 2 short).
   *  Undefined for Binance. Needed when cancel/replacing an order on a hedge
   *  account: Bybit rejects a repost whose index doesn't match the mode. */
  positionIdx?: number;
}

export interface Position {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  percentage: number;
  leverage: number;
  side: "LONG" | "SHORT" | "BOTH";
  /** Estimated liquidation price (0 if not provided). */
  liquidationPrice: number;
  /** USD notional of the position (|qty| * mark price). */
  notional: number;
  /** Initial margin locked for this position. */
  initialMargin: number;
  /** Maintenance margin requirement. */
  maintMargin: number;
  marginType: "isolated" | "cross";
  /** Take-profit price attached to the position (Bybit exposes this on the
   *  position itself; Binance leaves it undefined and uses reduceOnly orders). */
  takeProfit?: number;
  /** Stop-loss price attached to the position (see takeProfit). */
  stopLoss?: number;
  /** Bybit position index: 0 one-way, 1 hedge-long, 2 hedge-short. Needed to
   *  set TP/SL on hedge-mode accounts. Undefined for Binance. */
  positionIdx?: number;
}

/** Which exchange the trading credentials + routes target. */
export type Exchange = "binance" | "bybit";

export interface AssetBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface PlaceOrderParams {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  symbol: string;
  isPerp: boolean;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
  closePosition?: boolean;
  workingType?: "MARK_PRICE" | "CONTRACT_PRICE";
  exchange?: Exchange;
  /** Bybit hedge-mode position index (0 one-way, 1 long, 2 short). */
  positionIdx?: number;
  /** Bybit only: attach TP/SL directly to this order so Bybit sets it as the
   *  resulting position's own takeProfit/stopLoss (same as setting it by
   *  hand in Bybit's UI), instead of a separate reduceOnly conditional
   *  order. Binance has no equivalent field on order-create. */
  takeProfit?: string;
  stopLoss?: string;
}

export interface CancelOrderParams {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  symbol: string;
  isPerp: boolean;
  orderId: number | string;
  exchange?: Exchange;
}

/** Sizing modes shown in the Bybit-style order panel dropdown. */
export type SizingMode =
  | "AMOUNT"
  | "MARGIN_USD"
  | "PCT_BALANCE"
  | "RISK_USD"
  | "RISK_PCT";

/**
 * How the stop-loss field is expressed. The canonical value is always the stop
 * PRICE; these are just input units for *where* the stop sits.
 *
 * Risk deliberately isn't a unit here: risk belongs to the sizing modes
 * (`SizingMode.RISK_USD` / `RISK_PCT`), where stop + risk determine the
 * quantity. Offering it on both sides would make the two circular.
 */
export type SlMode = "PRICE" | "PCT_PRICE";

/** Symbol filters resolved from /fapi/v1/exchangeInfo (cached). */
export interface SymbolInfo {
  symbol: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
  minNotional: number;
}
