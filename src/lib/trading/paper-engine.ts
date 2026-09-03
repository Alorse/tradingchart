import { pnlAtExit } from "@/lib/trading/sizing";

/**
 * Paper-trading fills engine.
 *
 * Pure and framework-free: every entry point takes an account and returns a
 * *new* account plus the events the transition produced. The Zustand store in
 * `src/lib/store/paper-trading-store.ts` is the only stateful wrapper around
 * it, so all of the money math below is unit-testable without a chart, a
 * socket or a browser.
 *
 * Model, in one paragraph. The account holds a single free-cash `balance` in
 * USDT. Opening a position moves `margin = qty * entry / leverage` out of it
 * and charges the fee immediately; a resting limit order reserves the same
 * amount up front so a fill can never overdraw the account. Closing hands the
 * margin back along with the gross P&L, minus the exit fee. Positions net per
 * symbol (one-way mode, like the live Binance/Bybit panels the paper mode will
 * shadow): an opposite-side fill reduces, closes or flips rather than opening
 * a second row.
 *
 * The margin / equity accounting and the isolated-margin liquidation formula
 * follow the patterns in Saganaki22/BTC-trade-sim's `TradingEngine` (MIT),
 * reimplemented here rather than vendored — see the prior-art notes on #5.
 *
 * Deliberate simplifications, all of them worth revisiting once the UI exists:
 * no slippage (a bracket fills at its own price, not at the tick that crossed
 * it), no partial fills, no funding, and liquidation settles at the computed
 * liquidation price instead of walking an order book.
 */

export type PaperSide = "BUY" | "SELL";
export type PaperDirection = "LONG" | "SHORT";
export type PaperOrderType = "MARKET" | "LIMIT";
export type PaperOrderStatus = "NEW" | "FILLED" | "CANCELED";
/** Why a position (or a slice of one) was closed. */
export type CloseReason = "MANUAL" | "TP" | "SL" | "LIQUIDATION";

export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 125;

export interface PaperSettings {
  /** Virtual USDT handed out on first use and restored by `resetAccount`. */
  seedBalance: number;
  /** Fee rate on a market fill (0.0005 = 0.05%). */
  takerFeeRate: number;
  /** Fee rate on a resting limit fill. */
  makerFeeRate: number;
  /** Leverage the order form starts on. */
  defaultLeverage: number;
  /** Maintenance-margin rate used to place the liquidation price. */
  maintMarginRate: number;
}

export const DEFAULT_PAPER_SETTINGS: PaperSettings = {
  seedBalance: 10_000,
  takerFeeRate: 0.0005,
  makerFeeRate: 0.0002,
  defaultLeverage: 10,
  maintMarginRate: 0.005,
};

export interface PaperOrder {
  id: string;
  symbol: string;
  side: PaperSide;
  type: PaperOrderType;
  /** Limit price. Market orders never rest, so this is the fill price. */
  price: number;
  /** Quantity in base asset. */
  qty: number;
  leverage: number;
  status: PaperOrderStatus;
  /** Brackets carried onto the position the order opens. */
  tp: number | null;
  sl: number | null;
  /** Cash held out of `balance` while the order rests (margin + maker fee). */
  reserved: number;
  createdAt: number;
  updatedAt: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: PaperDirection;
  /** Always positive; `side` carries the direction. */
  qty: number;
  entryPrice: number;
  leverage: number;
  /** Initial margin locked out of `balance`. */
  margin: number;
  /** Entry fees already charged, carried so a close can report the round trip. */
  feesPaid: number;
  tp: number | null;
  sl: number | null;
  liquidationPrice: number;
  openedAt: number;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: PaperDirection;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  /** Margin released by this close (proportional on a partial). */
  margin: number;
  /** Entry share + exit fee. */
  fees: number;
  /** P&L before fees. */
  grossPnl: number;
  /** P&L after both legs' fees — the number the account actually moved by. */
  realizedPnl: number;
  /** `realizedPnl / margin`, i.e. return on the capital actually risked. */
  roi: number;
  reason: CloseReason;
  openedAt: number;
  closedAt: number;
  durationMs: number;
}

export interface PaperAccount {
  /** Free USDT: margin and reserves are already deducted from it. */
  balance: number;
  positions: PaperPosition[];
  orders: PaperOrder[];
  history: PaperTrade[];
  settings: PaperSettings;
}

export type PaperEvent =
  | {
      type: "fill";
      orderId: string | null;
      symbol: string;
      side: PaperSide;
      qty: number;
      price: number;
      fee: number;
    }
  | { type: "close"; symbol: string; reason: CloseReason; trade: PaperTrade }
  | { type: "cancel"; orderId: string; symbol: string }
  | { type: "reject"; symbol: string; message: string };

export interface EngineResult {
  account: PaperAccount;
  events: PaperEvent[];
}

export interface MarketOrderRequest {
  symbol: string;
  side: PaperSide;
  /** Base-asset quantity. */
  qty: number;
  leverage?: number;
  tp?: number | null;
  sl?: number | null;
}

export interface LimitOrderRequest extends MarketOrderRequest {
  price: number;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

let idSeq = 0;
function genId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

function clampLeverage(leverage: number | undefined, fallback: number): number {
  const n = leverage === undefined || !isFinite(leverage) ? fallback : leverage;
  return Math.min(MAX_LEVERAGE, Math.max(MIN_LEVERAGE, Math.round(n)));
}

function isPositive(n: number): boolean {
  return isFinite(n) && n > 0;
}

function directionOf(side: PaperSide): PaperDirection {
  return side === "BUY" ? "LONG" : "SHORT";
}

/** The order side that closes a position pointing this way. */
function closingSide(dir: PaperDirection): PaperSide {
  return dir === "LONG" ? "SELL" : "BUY";
}

/** Margin locked to hold `qty` at `price` on `leverage`x. */
export function marginFor(qty: number, price: number, leverage: number): number {
  if (leverage <= 0) return 0;
  return (qty * price) / leverage;
}

/**
 * Isolated-margin liquidation price: the mark at which the loss has eaten the
 * initial margin down to the maintenance requirement. Higher leverage puts it
 * closer to the entry, which is the whole point of showing it.
 */
export function liquidationPrice(
  side: PaperDirection,
  entry: number,
  leverage: number,
  maintMarginRate: number,
): number {
  if (!isPositive(entry) || leverage <= 0) return 0;
  const buffer = 1 / leverage - maintMarginRate;
  const price = side === "LONG" ? entry * (1 - buffer) : entry * (1 + buffer);
  return price > 0 ? price : 0;
}

/** Signed P&L (USDT) if the position exits at `price`. */
export function unrealizedPnl(position: PaperPosition, price: number): number {
  if (!isPositive(price)) return 0;
  return pnlAtExit(position.entryPrice, price, position.qty, closingSideEntry(position.side));
}

/** The *entry* side of a direction — what `pnlAtExit` signs its result by. */
function closingSideEntry(dir: PaperDirection): PaperSide {
  return dir === "LONG" ? "BUY" : "SELL";
}

/** Unrealized P&L over the position's initial margin (true ROI, not a
 *  price-delta × leverage estimate — see the note in CLAUDE.md). */
export function positionRoi(position: PaperPosition, price: number): number {
  if (position.margin <= 0) return 0;
  return unrealizedPnl(position, price) / position.margin;
}

/** Everything currently locked: position margin plus resting-order reserves. */
export function usedMargin(account: PaperAccount): number {
  const inPositions = account.positions.reduce((s, p) => s + p.margin, 0);
  const inOrders = account.orders.reduce(
    (s, o) => s + (o.status === "NEW" ? o.reserved : 0),
    0,
  );
  return inPositions + inOrders;
}

/**
 * Account equity: free cash + everything locked + open P&L. A symbol missing
 * from `marks` falls back to its own entry price (a position that has never
 * ticked is worth what it cost).
 */
export function equity(account: PaperAccount, marks: Record<string, number>): number {
  const open = account.positions.reduce(
    (s, p) => s + unrealizedPnl(p, marks[p.symbol] ?? p.entryPrice),
    0,
  );
  return account.balance + usedMargin(account) + open;
}

/* ── account lifecycle ───────────────────────────────────────────────────── */

export function createAccount(settings?: Partial<PaperSettings>): PaperAccount {
  const merged = { ...DEFAULT_PAPER_SETTINGS, ...settings };
  return {
    balance: merged.seedBalance,
    positions: [],
    orders: [],
    history: [],
    settings: merged,
  };
}

/** Back to the seed, keeping whatever settings the user configured. */
export function resetAccount(account: PaperAccount): PaperAccount {
  return createAccount(account.settings);
}

/** Patch the account's settings, leaving its balance and open state alone. */
export function updateSettings(
  account: PaperAccount,
  patch: Partial<PaperSettings>,
): PaperAccount {
  return { ...account, settings: { ...account.settings, ...patch } };
}

/* ── fills ───────────────────────────────────────────────────────────────── */

function reject(account: PaperAccount, symbol: string, message: string): EngineResult {
  return { account, events: [{ type: "reject", symbol, message }] };
}

interface CloseSlice {
  balanceDelta: number;
  trade: PaperTrade;
  /** null once the position is fully closed. */
  position: PaperPosition | null;
}

/**
 * Close `qty` of `position` at `exitPrice`. Returns the cash to credit and the
 * booked trade. The entry fee was charged when the position opened, so it is
 * reported in the trade but *not* deducted from the balance a second time.
 */
function closeSlice(
  position: PaperPosition,
  qty: number,
  exitPrice: number,
  feeRate: number,
  reason: CloseReason,
  now: number,
): CloseSlice {
  const closedQty = Math.min(qty, position.qty);
  const fraction = closedQty / position.qty;
  const releasedMargin = position.margin * fraction;
  const entryFeeShare = position.feesPaid * fraction;
  const exitFee = closedQty * exitPrice * feeRate;
  const grossPnl = pnlAtExit(
    position.entryPrice,
    exitPrice,
    closedQty,
    closingSideEntry(position.side),
  );
  const realizedPnl = grossPnl - entryFeeShare - exitFee;

  const trade: PaperTrade = {
    id: genId("t"),
    symbol: position.symbol,
    side: position.side,
    qty: closedQty,
    entryPrice: position.entryPrice,
    exitPrice,
    leverage: position.leverage,
    margin: releasedMargin,
    fees: entryFeeShare + exitFee,
    grossPnl,
    realizedPnl,
    roi: releasedMargin > 0 ? realizedPnl / releasedMargin : 0,
    reason,
    openedAt: position.openedAt,
    closedAt: now,
    durationMs: now - position.openedAt,
  };

  const remaining = position.qty - closedQty;
  return {
    balanceDelta: releasedMargin + grossPnl - exitFee,
    trade,
    position:
      remaining > 0
        ? {
            ...position,
            qty: remaining,
            margin: position.margin - releasedMargin,
            feesPaid: position.feesPaid - entryFeeShare,
          }
        : null,
  };
}

/**
 * Apply a fill of `qty` at `price` to the account, netting against whatever is
 * open on that symbol. This is the single path every fill goes through —
 * market orders, limit crossings and closes alike.
 */
function applyFill(
  account: PaperAccount,
  args: {
    symbol: string;
    side: PaperSide;
    qty: number;
    price: number;
    leverage: number;
    feeRate: number;
    tp: number | null;
    sl: number | null;
    orderId: string | null;
    now: number;
  },
): EngineResult {
  const { symbol, side, qty, price, leverage, feeRate, orderId, now } = args;
  if (!isPositive(qty) || !isPositive(price)) {
    return reject(account, symbol, "Invalid quantity or price");
  }

  const events: PaperEvent[] = [];
  let balance = account.balance;
  let positions = account.positions;
  let history = account.history;

  const existing = positions.find((p) => p.symbol === symbol) ?? null;
  let openQty = qty;

  // Opposite side: reduce, close, or flip before opening anything new.
  if (existing && side === closingSide(existing.side)) {
    const reduceQty = Math.min(qty, existing.qty);
    const slice = closeSlice(existing, reduceQty, price, feeRate, "MANUAL", now);
    balance += slice.balanceDelta;
    positions = slice.position
      ? positions.map((p) => (p.id === existing.id ? slice.position! : p))
      : positions.filter((p) => p.id !== existing.id);
    history = [...history, slice.trade];
    events.push({ type: "close", symbol, reason: "MANUAL", trade: slice.trade });
    openQty = qty - reduceQty;
  }

  if (openQty <= 0) {
    events.push({ type: "fill", orderId, symbol, side, qty, price, fee: qty * price * feeRate });
    return { account: { ...account, balance, positions, history }, events };
  }

  const margin = marginFor(openQty, price, leverage);
  const fee = openQty * price * feeRate;
  if (balance + 1e-9 < margin + fee) {
    // Nothing is applied: an order the account cannot margin is refused whole,
    // including any reducing leg it came bundled with.
    return reject(account, symbol, "Insufficient paper balance");
  }
  balance -= margin + fee;

  const sameSide = positions.find((p) => p.symbol === symbol) ?? null;
  if (sameSide) {
    const totalQty = sameSide.qty + openQty;
    const entryPrice =
      (sameSide.entryPrice * sameSide.qty + price * openQty) / totalQty;
    const merged: PaperPosition = {
      ...sameSide,
      qty: totalQty,
      entryPrice,
      leverage,
      margin: sameSide.margin + margin,
      feesPaid: sameSide.feesPaid + fee,
      tp: args.tp ?? sameSide.tp,
      sl: args.sl ?? sameSide.sl,
      liquidationPrice: liquidationPrice(
        sameSide.side,
        entryPrice,
        leverage,
        account.settings.maintMarginRate,
      ),
    };
    positions = positions.map((p) => (p.id === sameSide.id ? merged : p));
  } else {
    const dir = directionOf(side);
    positions = [
      ...positions,
      {
        id: genId("p"),
        symbol,
        side: dir,
        qty: openQty,
        entryPrice: price,
        leverage,
        margin,
        feesPaid: fee,
        tp: args.tp ?? null,
        sl: args.sl ?? null,
        liquidationPrice: liquidationPrice(
          dir,
          price,
          leverage,
          account.settings.maintMarginRate,
        ),
        openedAt: now,
      },
    ];
  }

  events.push({ type: "fill", orderId, symbol, side, qty, price, fee });
  return { account: { ...account, balance, positions, history }, events };
}

/** Market order: fills immediately at the quote, paying the taker fee. */
export function fillMarketOrder(
  account: PaperAccount,
  req: MarketOrderRequest,
  price: number,
  now: number,
): EngineResult {
  return applyFill(account, {
    symbol: req.symbol,
    side: req.side,
    qty: req.qty,
    price,
    leverage: clampLeverage(req.leverage, account.settings.defaultLeverage),
    feeRate: account.settings.takerFeeRate,
    tp: req.tp ?? null,
    sl: req.sl ?? null,
    orderId: null,
    now,
  });
}

/**
 * Rest a limit order, holding margin + the maker fee out of the free balance
 * so the eventual fill can never overdraw the account.
 */
export function placeLimitOrder(
  account: PaperAccount,
  req: LimitOrderRequest,
  now: number,
): EngineResult {
  if (!isPositive(req.qty) || !isPositive(req.price)) {
    return reject(account, req.symbol, "Invalid quantity or price");
  }
  const leverage = clampLeverage(req.leverage, account.settings.defaultLeverage);
  const reserved =
    marginFor(req.qty, req.price, leverage) +
    req.qty * req.price * account.settings.makerFeeRate;
  if (account.balance + 1e-9 < reserved) {
    return reject(account, req.symbol, "Insufficient paper balance");
  }

  const order: PaperOrder = {
    id: genId("o"),
    symbol: req.symbol,
    side: req.side,
    type: "LIMIT",
    price: req.price,
    qty: req.qty,
    leverage,
    status: "NEW",
    tp: req.tp ?? null,
    sl: req.sl ?? null,
    reserved,
    createdAt: now,
    updatedAt: now,
  };
  return {
    account: {
      ...account,
      balance: account.balance - reserved,
      orders: [...account.orders, order],
    },
    events: [],
  };
}

/** Cancel a resting order and hand its reserve back. Unknown ids are no-ops. */
export function cancelOrder(
  account: PaperAccount,
  orderId: string,
  now: number,
): EngineResult {
  const order = account.orders.find((o) => o.id === orderId && o.status === "NEW");
  if (!order) return { account, events: [] };
  void now;
  return {
    account: {
      ...account,
      balance: account.balance + order.reserved,
      orders: account.orders.filter((o) => o.id !== orderId),
    },
    events: [{ type: "cancel", orderId, symbol: order.symbol }],
  };
}

/**
 * Close a position (or `qty` of it) at `price`, paying the taker fee. Used by
 * the manual close button and by every bracket/liquidation trigger.
 */
export function closePosition(
  account: PaperAccount,
  symbol: string,
  price: number,
  now: number,
  qty?: number,
  reason: CloseReason = "MANUAL",
): EngineResult {
  const position = account.positions.find((p) => p.symbol === symbol);
  if (!position || !isPositive(price)) return { account, events: [] };

  const closeQty = qty === undefined ? position.qty : Math.min(qty, position.qty);
  if (!isPositive(closeQty)) return { account, events: [] };

  const slice = closeSlice(
    position,
    closeQty,
    price,
    account.settings.takerFeeRate,
    reason,
    now,
  );
  return {
    account: {
      ...account,
      balance: account.balance + slice.balanceDelta,
      positions: slice.position
        ? account.positions.map((p) => (p.id === position.id ? slice.position! : p))
        : account.positions.filter((p) => p.id !== position.id),
      history: [...account.history, slice.trade],
    },
    events: [{ type: "close", symbol, reason, trade: slice.trade }],
  };
}

/** Attach or clear a position's brackets. Absent keys are left alone. */
export function setBrackets(
  account: PaperAccount,
  symbol: string,
  brackets: { tp?: number | null; sl?: number | null },
): PaperAccount {
  const position = account.positions.find((p) => p.symbol === symbol);
  if (!position) return account;
  return {
    ...account,
    positions: account.positions.map((p) =>
      p.id === position.id
        ? {
            ...p,
            tp: brackets.tp === undefined ? p.tp : brackets.tp,
            sl: brackets.sl === undefined ? p.sl : brackets.sl,
          }
        : p,
    ),
  };
}

/* ── per-tick evaluation ─────────────────────────────────────────────────── */

/** True when a resting limit order should fill at `price`. */
export function limitCrosses(order: PaperOrder, price: number): boolean {
  return order.side === "BUY" ? price <= order.price : price >= order.price;
}

/**
 * Which exit, if any, this tick triggers for `position`.
 *
 * The stop-loss is tested first on purpose. A single price can satisfy both
 * legs only in a degenerate configuration (a stop trailed past the target),
 * and in that case the protective leg is the one that has to win — the same
 * precedence a real venue applies. At most one exit is returned, so a position
 * can never be closed twice on one tick.
 */
export function triggeredExit(
  position: PaperPosition,
  price: number,
): { reason: CloseReason; price: number } | null {
  const long = position.side === "LONG";
  if (position.sl !== null && (long ? price <= position.sl : price >= position.sl)) {
    return { reason: "SL", price: position.sl };
  }
  if (position.tp !== null && (long ? price >= position.tp : price <= position.tp)) {
    return { reason: "TP", price: position.tp };
  }
  const liq = position.liquidationPrice;
  if (liq > 0 && (long ? price <= liq : price >= liq)) {
    return { reason: "LIQUIDATION", price: liq };
  }
  return null;
}

/**
 * Drive the engine off one live price tick.
 *
 * Cheap by construction so it can sit directly on the WebSocket callback: it
 * scans only the two (small) arrays, and when the tick changes nothing it
 * returns the **same** account object, so a subscribed React tree re-renders
 * only on an actual fill. Calling it repeatedly at the same price is a no-op.
 */
export function evaluateTick(
  account: PaperAccount,
  symbol: string,
  price: number,
  now: number,
): EngineResult {
  if (!isPositive(price)) return { account, events: [] };

  let acc = account;
  let events: PaperEvent[] = [];

  // Resting limit orders first: an order that fills on this tick gets its
  // brackets evaluated by the *next* one, never by the tick that opened it.
  const crossing = acc.orders.filter(
    (o) => o.status === "NEW" && o.symbol === symbol && limitCrosses(o, price),
  );
  for (const order of crossing) {
    const released: PaperAccount = {
      ...acc,
      balance: acc.balance + order.reserved,
      orders: acc.orders.filter((o) => o.id !== order.id),
    };
    const res = applyFill(released, {
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      price: order.price,
      leverage: order.leverage,
      feeRate: acc.settings.makerFeeRate,
      tp: order.tp,
      sl: order.sl,
      orderId: order.id,
      now,
    });
    // A rejected fill leaves the order resting and its reserve untouched.
    if (res.events.some((e) => e.type === "reject")) {
      events = [...events, ...res.events];
      continue;
    }
    acc = res.account;
    events = [...events, ...res.events];
  }

  // Then brackets and liquidation, at most one trigger per position.
  const position = acc.positions.find((p) => p.symbol === symbol);
  if (position) {
    const exit = triggeredExit(position, price);
    if (exit) {
      const res = closePosition(acc, symbol, exit.price, now, undefined, exit.reason);
      acc = res.account;
      events = [...events, ...res.events];
    }
  }

  return { account: acc, events };
}
