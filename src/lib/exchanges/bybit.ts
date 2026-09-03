import crypto from "node:crypto";
import type {
  Order,
  Position,
  AssetBalance,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
} from "@/lib/binance/trading-types";

/**
 * Bybit V5 REST helper (server-side). Signs requests with the V5 scheme and
 * normalizes responses to the same shapes the Binance routes emit, so the
 * client store/UI stay exchange-agnostic.
 *
 * V5 signature: HMAC_SHA256(secret, timestamp + apiKey + recvWindow + payload)
 *   - GET  payload = the exact (sorted) query string
 *   - POST payload = the exact raw JSON body
 * Auth headers: X-BAPI-API-KEY / -TIMESTAMP / -RECV-WINDOW / -SIGN.
 */

const PROD = "https://api.bybit.com";
const TEST = "https://api-testnet.bybit.com";
const RECV_WINDOW = "60000";

export interface BybitCreds {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

export function bybitBaseUrl(testnet: boolean): string {
  return testnet ? TEST : PROD;
}

/** USDT-margined perps are `linear`; everything else routes to `spot`. */
export function bybitCategory(isPerp: boolean): "linear" | "spot" {
  return isPerp ? "linear" : "spot";
}

/** The exact string that gets HMAC-signed. Exposed for unit tests. */
export function bybitPreSign(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  payload: string,
): string {
  return `${timestamp}${apiKey}${recvWindow}${payload}`;
}

/** Deterministic query string (sorted keys) so the signed payload matches the
 *  wire order regardless of insertion order. */
export function bybitQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
}

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

async function bybitGet<T>(
  creds: BybitCreds,
  path: string,
  params: Record<string, string>,
): Promise<BybitEnvelope<T>> {
  const timestamp = Date.now().toString();
  const qs = bybitQueryString(params);
  const sign = crypto
    .createHmac("sha256", creds.apiSecret)
    .update(bybitPreSign(timestamp, creds.apiKey, RECV_WINDOW, qs))
    .digest("hex");
  const url = `${bybitBaseUrl(creds.testnet)}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": sign,
    },
  });
  return (await res.json()) as BybitEnvelope<T>;
}

async function bybitPost<T>(
  creds: BybitCreds,
  path: string,
  body: Record<string, unknown>,
): Promise<BybitEnvelope<T>> {
  const timestamp = Date.now().toString();
  const raw = JSON.stringify(body);
  const sign = crypto
    .createHmac("sha256", creds.apiSecret)
    .update(bybitPreSign(timestamp, creds.apiKey, RECV_WINDOW, raw))
    .digest("hex");
  const res = await fetch(`${bybitBaseUrl(creds.testnet)}${path}`, {
    method: "POST",
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": sign,
      "Content-Type": "application/json",
    },
    body: raw,
  });
  return (await res.json()) as BybitEnvelope<T>;
}

/** Thrown-shaped error the routes can forward with a `msg` field. */
export class BybitError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

function ensureOk<T>(env: BybitEnvelope<T>): T {
  if (env.retCode !== 0) throw new BybitError(env.retCode, env.retMsg || "Bybit error");
  return env.result;
}

/* ───────────────────────── pure mappers ───────────────────────── */

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export interface RawBybitPosition {
  symbol: string;
  side: string; // "Buy" | "Sell" | ""
  size: string;
  avgPrice: string;
  positionValue: string;
  leverage: string;
  markPrice: string;
  liqPrice: string;
  unrealisedPnl: string;
  positionIM: string;
  positionMM: string;
  takeProfit: string;
  stopLoss: string;
  tradeMode: number; // 0 cross, 1 isolated
  positionIdx: number; // 0 one-way, 1 hedge-long, 2 hedge-short
}

export function mapBybitPosition(p: RawBybitPosition): Position {
  const size = num(p.size);
  const sign = p.side === "Sell" ? -1 : 1;
  const positionAmt = size * sign;
  const entryPrice = num(p.avgPrice);
  const markPrice = num(p.markPrice);
  const leverage = num(p.leverage) || 1;
  const unrealizedProfit = num(p.unrealisedPnl);
  const initialMargin = num(p.positionIM);
  // ROI% = unrealized P&L / initial margin, matching Bybit's own displayed
  // percentage (and what TradingView shows via a Bybit connection). This
  // differs from a naive (mark-entry)/entry * leverage estimate whenever extra
  // margin was added/removed or the position runs on cross margin — both cases
  // make the naive formula wrong by an arbitrary factor and sometimes even the
  // wrong sign, unlike the true P&L/margin ratio.
  const percentage = initialMargin > 0
    ? (unrealizedProfit / initialMargin) * 100
    : entryPrice > 0
      ? ((markPrice - entryPrice) / entryPrice) * 100 * leverage * (positionAmt >= 0 ? 1 : -1)
      : 0;
  return {
    symbol: p.symbol,
    positionAmt,
    entryPrice,
    markPrice,
    unrealizedProfit,
    percentage,
    leverage,
    side: positionAmt > 0 ? "LONG" : positionAmt < 0 ? "SHORT" : "BOTH",
    liquidationPrice: num(p.liqPrice),
    notional: num(p.positionValue) || Math.abs(positionAmt * markPrice),
    initialMargin,
    maintMargin: num(p.positionMM),
    marginType: p.tradeMode === 1 ? "isolated" : "cross",
    takeProfit: num(p.takeProfit) || undefined,
    stopLoss: num(p.stopLoss) || undefined,
    positionIdx: p.positionIdx ?? 0,
  };
}

export interface RawBybitOrder {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: string; // "Buy" | "Sell"
  orderType: string; // "Limit" | "Market"
  stopOrderType: string; // "" | "TakeProfit" | "StopLoss" | "Stop" | "PartialTakeProfit" | ...
  price: string;
  qty: string;
  cumExecQty: string;
  orderStatus: string;
  triggerPrice: string;
  timeInForce: string;
  reduceOnly: boolean;
  createdTime: string;
  updatedTime: string;
  /** 0 one-way, 1 hedge-long, 2 hedge-short. */
  positionIdx?: number;
}

function mapBybitOrderType(o: RawBybitOrder): OrderType {
  const stop = o.stopOrderType || "";
  if (stop.includes("TakeProfit")) return "TAKE_PROFIT_MARKET";
  if (stop.includes("StopLoss") || stop === "Stop") return "STOP_MARKET";
  return o.orderType === "Market" ? "MARKET" : "LIMIT";
}

function mapBybitStatus(s: string): OrderStatus {
  switch (s) {
    case "New":
    case "Untriggered":
    case "Triggered":
      return "NEW";
    case "PartiallyFilled":
      return "PARTIALLY_FILLED";
    case "Filled":
      return "FILLED";
    case "Rejected":
      return "REJECTED";
    case "Cancelled":
    case "Deactivated":
    case "PartiallyFilledCanceled":
      return "CANCELED";
    default:
      return "NEW";
  }
}

function mapBybitTif(t: string): TimeInForce {
  switch (t) {
    case "IOC":
      return "IOC";
    case "FOK":
      return "FOK";
    case "PostOnly":
      return "GTX";
    default:
      return "GTC";
  }
}

/** Maps a Bybit order to the same normalized `Order` the store consumes. */
export function mapBybitOrder(o: RawBybitOrder): Order {
  const type = mapBybitOrderType(o);
  const isTrigger = type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET";
  return {
    orderId: o.orderId,
    clientOrderId: o.orderLinkId,
    symbol: o.symbol,
    side: (o.side === "Sell" ? "SELL" : "BUY") as OrderSide,
    type,
    status: mapBybitStatus(o.orderStatus),
    price: num(o.price),
    origQty: num(o.qty),
    executedQty: num(o.cumExecQty),
    stopPrice: isTrigger ? num(o.triggerPrice) || undefined : undefined,
    timeInForce: mapBybitTif(o.timeInForce),
    time: num(o.createdTime),
    updateTime: num(o.updatedTime),
    reduceOnly: o.reduceOnly ?? false,
    isPerp: true,
    // Carried so a cancel/replace can re-post into the same hedge slot.
    positionIdx: o.positionIdx,
  };
}

export interface RawBybitCoin {
  coin: string;
  walletBalance: string;
  availableToWithdraw: string;
  free?: string;
  equity: string;
}

export function mapBybitBalance(coins: RawBybitCoin[]): AssetBalance[] {
  return coins
    .map((c) => {
      const wallet = num(c.walletBalance);
      const free = num(c.availableToWithdraw) || num(c.free) || wallet;
      return { asset: c.coin, free, locked: Math.max(0, wallet - free) };
    })
    .filter((b) => b.free > 0 || b.locked > 0);
}

function decimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = step.toString();
  if (s.includes("e-")) return parseInt(s.split("e-")[1], 10);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

export interface RawBybitInstrument {
  symbol: string;
  status: string;
  priceFilter: { tickSize: string };
  lotSizeFilter: { qtyStep: string; minOrderQty: string; minNotionalValue?: string };
}

export function mapBybitInstrument(i: RawBybitInstrument) {
  const tickSize = num(i.priceFilter.tickSize) || 0.01;
  const stepSize = num(i.lotSizeFilter.qtyStep) || 0.001;
  return {
    symbol: i.symbol,
    status: i.status,
    pricePrecision: decimals(tickSize),
    quantityPrecision: decimals(stepSize),
    tickSize,
    stepSize,
    minNotional: num(i.lotSizeFilter.minNotionalValue) || 5,
  };
}

/* ───────────────────── high-level operations ───────────────────── */

export async function bybitGetPositions(
  creds: BybitCreds,
  symbol: string,
): Promise<Position[]> {
  const result = ensureOk(
    await bybitGet<{ list: RawBybitPosition[] }>(creds, "/v5/position/list", {
      category: "linear",
      ...(symbol ? { symbol } : { settleCoin: "USDT" }),
    }),
  );
  return (result.list ?? [])
    .filter((p) => num(p.size) !== 0)
    .map(mapBybitPosition);
}

/**
 * Whether a symbol is in Bybit hedge mode (positionIdx 1/2) rather than
 * one-way (0). Once a symbol is switched to hedge mode, `/v5/position/list`
 * keeps returning its two dormant (size 0) position rows, so this stays
 * accurate even while flat — unlike inferring hedge mode from currently-open
 * (non-zero) positions, which goes blind the moment the symbol is flat and
 * would then submit orders without a positionIdx, which Bybit rejects when
 * the account is actually in hedge mode.
 */
export async function bybitIsHedgeMode(creds: BybitCreds, symbol: string): Promise<boolean> {
  const result = ensureOk(
    await bybitGet<{ list: RawBybitPosition[] }>(creds, "/v5/position/list", {
      category: "linear",
      symbol,
    }),
  );
  return (result.list ?? []).some((p) => p.positionIdx === 1 || p.positionIdx === 2);
}

export async function bybitGetOrders(
  creds: BybitCreds,
  isPerp: boolean,
  symbol: string,
): Promise<Order[]> {
  const category = bybitCategory(isPerp);
  const result = ensureOk(
    await bybitGet<{ list: RawBybitOrder[] }>(creds, "/v5/order/realtime", {
      category,
      ...(symbol ? { symbol } : category === "linear" ? { settleCoin: "USDT" } : {}),
    }),
  );
  return (result.list ?? []).map(mapBybitOrder);
}

export async function bybitGetBalance(creds: BybitCreds): Promise<AssetBalance[]> {
  const result = ensureOk(
    await bybitGet<{ list: { coin: RawBybitCoin[] }[] }>(
      creds,
      "/v5/account/wallet-balance",
      { accountType: "UNIFIED" },
    ),
  );
  return mapBybitBalance(result.list?.[0]?.coin ?? []);
}

/** Public (unsigned) instrument lookup — `/v5/market/*` needs no credentials. */
export async function bybitGetInstrumentPublic(
  testnet: boolean,
  isPerp: boolean,
  symbol: string,
) {
  const qs = bybitQueryString({ category: bybitCategory(isPerp), symbol });
  const res = await fetch(`${bybitBaseUrl(testnet)}/v5/market/instruments-info?${qs}`, {
    next: { revalidate: 3600 },
  });
  const env = (await res.json()) as BybitEnvelope<{ list: RawBybitInstrument[] }>;
  const inst = ensureOk(env).list?.[0];
  if (!inst) throw new BybitError(-1, "Symbol not found");
  return mapBybitInstrument(inst);
}

export interface BybitPlaceArgs {
  isPerp: boolean;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;
  stopPrice?: string;
  reduceOnly?: boolean;
  timeInForce?: TimeInForce;
  takeProfit?: string;
  stopLoss?: string;
  positionIdx?: number;
}

export async function bybitPlaceOrder(creds: BybitCreds, a: BybitPlaceArgs) {
  const category = bybitCategory(a.isPerp);
  const isTrigger = a.type === "STOP_MARKET" || a.type === "TAKE_PROFIT_MARKET";
  const side = a.side === "SELL" ? "Sell" : "Buy";
  const orderType = a.type === "MARKET" || isTrigger ? "Market" : "Limit";

  const body: Record<string, unknown> = {
    category,
    symbol: a.symbol,
    side,
    orderType,
    qty: a.quantity,
  };
  if (a.positionIdx !== undefined) body.positionIdx = a.positionIdx;
  if (orderType === "Limit" && a.price) body.price = a.price;
  if (a.timeInForce === "GTX") body.timeInForce = "PostOnly";
  else if (a.timeInForce && a.timeInForce !== "GTC") body.timeInForce = a.timeInForce;
  if (a.reduceOnly) body.reduceOnly = true;
  if (a.takeProfit || a.stopLoss) {
    // "Full" applies the stop to the whole position (this app never splits
    // TP/SL across partial size), matching bybitSetTradingStop's convention.
    body.tpslMode = "Full";
    if (a.takeProfit) {
      body.takeProfit = a.takeProfit;
      body.tpTriggerBy = "MarkPrice";
    }
    if (a.stopLoss) {
      body.stopLoss = a.stopLoss;
      body.slTriggerBy = "MarkPrice";
    }
  }

  if (isTrigger && a.stopPrice) {
    body.triggerPrice = a.stopPrice;
    // 1 = trigger when mark price rises to trigger; 2 = when it falls.
    // A reduce SELL that triggers above price is a TP; below is a stop, etc.
    const trigAbove = a.type === "TAKE_PROFIT_MARKET" ? a.side === "SELL" : a.side === "BUY";
    body.triggerDirection = trigAbove ? 1 : 2;
    body.triggerBy = "MarkPrice";
  }

  return ensureOk(await bybitPost<{ orderId: string }>(creds, "/v5/order/create", body));
}

export async function bybitCancelOrder(
  creds: BybitCreds,
  isPerp: boolean,
  symbol: string,
  orderId: string | number,
) {
  return ensureOk(
    await bybitPost(creds, "/v5/order/cancel", {
      category: bybitCategory(isPerp),
      symbol,
      orderId: String(orderId),
    }),
  );
}

export async function bybitSetLeverage(creds: BybitCreds, symbol: string, leverage: number) {
  return ensureOk(
    await bybitPost(creds, "/v5/position/set-leverage", {
      category: "linear",
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    }),
  );
}

/** Set TP and/or SL on an open position. `null` clears the level (sent as "0").
 *  `positionIdx` must match the account's position mode (0 one-way, 1/2 hedge). */
export async function bybitSetTradingStop(
  creds: BybitCreds,
  symbol: string,
  args: { tp?: number | null; sl?: number | null; positionIdx?: number },
) {
  const body: Record<string, unknown> = {
    category: "linear",
    symbol,
    tpslMode: "Full",
    positionIdx: args.positionIdx ?? 0,
  };
  if (args.tp !== undefined) body.takeProfit = args.tp === null ? "0" : String(args.tp);
  if (args.sl !== undefined) body.stopLoss = args.sl === null ? "0" : String(args.sl);
  return ensureOk(await bybitPost(creds, "/v5/position/trading-stop", body));
}
