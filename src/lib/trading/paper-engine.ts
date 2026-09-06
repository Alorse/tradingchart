import { bracketSidesValid } from "@/lib/trading/paper-brackets";
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
 * no slippage on TP/SL/liquidation triggers (a bracket still fills at its own
 * price, never the tick that crossed it — see `triggeredExit`), no partial
 * fills, no funding, and liquidation settles at the computed liquidation
 * price instead of walking an order book. A resting *limit order*, unlike a
 * bracket, fills at the tick that crosses it rather than its own price — see
 * `evaluateTick`.
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
  /**
   * The decorated chart symbol (`.P` / `BYBIT:` intact) this order was placed
   * from, i.e. what a live WS subscription needs — `symbol` above has had its
   * venue prefix stripped (positions net across venues but not across
   * spot/perp) and so can't tell a Binance perp from a Bybit one sharing the
   * same ticker. `null` when the request that created this order didn't carry
   * one (a direct engine call outside the UI). See `paperFeedExposure`.
   */
  feedSymbol: string | null;
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
  /** See `PaperOrder.feedSymbol` — the decorated symbol whose live feed drives this position. */
  feedSymbol: string | null;
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
      /**
       * Fee charged by *this* fill that isn't already reported by an
       * accompanying "close" event's `trade.fees` — zero on a pure reduce
       * (the exit fee is already in `trade.fees`), the opening leg's fee
       * alone on a flip (the reducing leg's fee is, likewise, already in
       * `trade.fees`), and the whole fee on a fresh open, which has no
       * accompanying close event at all.
       */
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
  /** See `PaperOrder.feedSymbol`. Optional so tests/direct engine callers
   *  need not supply one; the resulting position/order then carries `null`
   *  and is simply skipped by the live exposure feed, same as today. */
  feedSymbol?: string | null;
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

/** The order side that *opened* a position pointing this way — what
 *  `pnlAtExit` signs its result by. Inverse of `directionOf`. */
function entrySide(dir: PaperDirection): PaperSide {
  return dir === "LONG" ? "BUY" : "SELL";
}

/** The order side that closes a position pointing this way. */
function closingSide(dir: PaperDirection): PaperSide {
  return entrySide(dir) === "BUY" ? "SELL" : "BUY";
}

/** Margin locked to hold `qty` at `price` on `leverage`x. */
export function marginFor(qty: number, price: number, leverage: number): number {
  if (leverage <= 0) return 0;
  return (qty * price) / leverage;
}

/**
 * Isolated-margin liquidation price: the mark at which the loss has eaten the
 * initial margin down to the maintenance requirement. Higher leverage puts it
 * closer to the entry, which is the whole point of showing it. The buffer is
 * clamped to zero — a maintenance rate at or above `1/leverage` would
 * otherwise put liquidation on the wrong side of entry, liquidating the
 * position on its very first tick.
 */
export function liquidationPrice(
  side: PaperDirection,
  entry: number,
  leverage: number,
  maintMarginRate: number,
): number {
  if (!isPositive(entry) || leverage <= 0) return 0;
  const buffer = Math.max(0, 1 / leverage - maintMarginRate);
  const price = side === "LONG" ? entry * (1 - buffer) : entry * (1 + buffer);
  return price > 0 ? price : 0;
}

/**
 * Liquidation price derived straight from the margin actually locked, rather
 * than from a single leverage figure. A same-side merge blends slices opened
 * at different leverages: summing their margins is correct, but a leverage
 * recomputed from the blended entry (or simply overwritten by the latest
 * fill's) does not describe what is actually backing the position, and can
 * put liquidation absurdly close to — or absurdly far from — entry. Buffer is
 * clamped to zero for the same reason as `liquidationPrice`.
 */
export function liquidationPriceFromMargin(
  side: PaperDirection,
  entry: number,
  qty: number,
  margin: number,
  maintMarginRate: number,
): number {
  if (!isPositive(entry) || !isPositive(qty)) return 0;
  const maintMargin = qty * entry * maintMarginRate;
  const buffer = Math.max(0, (margin - maintMargin) / qty);
  const price = side === "LONG" ? entry - buffer : entry + buffer;
  return price > 0 ? price : 0;
}

/** Signed P&L (USDT) if the position exits at `price`. */
export function unrealizedPnl(position: PaperPosition, price: number): number {
  if (!isPositive(price)) return 0;
  return pnlAtExit(position.entryPrice, price, position.qty, entrySide(position.side));
}

/** Unrealized P&L over the position's initial margin (true ROI, not a
 *  price-delta × leverage estimate — see the note in CLAUDE.md). */
export function positionRoi(position: PaperPosition, price: number): number {
  if (position.margin <= 0) return 0;
  return unrealizedPnl(position, price) / position.margin;
}

/** Sum of unrealized P&L across every open position, each valued at its own
 *  mark — falling back to entry when the symbol hasn't ticked yet, same as
 *  `equity()`. */
export function totalUnrealizedPnl(
  positions: PaperPosition[],
  marks: Record<string, number>,
): number {
  return positions.reduce((s, p) => s + unrealizedPnl(p, marks[p.symbol] ?? p.entryPrice), 0);
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
  return account.balance + usedMargin(account) + totalUnrealizedPnl(account.positions, marks);
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

/** A fee rate above 1% is not a real venue's, and a negative one pays the trader to trade. */
const MAX_FEE_RATE = 0.01;

/** Inclusive on both ends. */
function isFiniteInRange(
  n: unknown,
  { min, max, exclusiveMin, exclusiveMax }: SettingRange,
): n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) return false;
  if (exclusiveMin ? n <= min : n < min) return false;
  return exclusiveMax ? n < max : n <= max;
}

interface SettingRange {
  min: number;
  max: number;
  exclusiveMin?: true;
  exclusiveMax?: true;
}

/**
 * The range each numeric setting has to land in to be accepted. `maintMarginRate`
 * is capped *strictly* under 1/MAX_LEVERAGE: at exactly that value,
 * `liquidationPrice`'s buffer clamps to zero for a position at that same
 * leverage, liquidating it on its very first tick.
 *
 * `defaultLeverage` isn't here — it clamps rather than drops (see below).
 */
const SETTING_RANGES: Record<
  "takerFeeRate" | "makerFeeRate" | "maintMarginRate" | "seedBalance",
  SettingRange
> = {
  takerFeeRate: { min: 0, max: MAX_FEE_RATE },
  makerFeeRate: { min: 0, max: MAX_FEE_RATE },
  maintMarginRate: { min: 0, max: 1 / MAX_LEVERAGE, exclusiveMax: true },
  seedBalance: { min: 0, max: Infinity, exclusiveMin: true },
};

/**
 * Patch the account's settings, leaving its balance and open state alone.
 * Each key is validated independently against the range a real venue could
 * plausibly have, and — like a corrupted persisted blob (see the store's
 * `merge`) — a key that fails validation is silently dropped rather than
 * thrown: this runs off a live settings form, and one bad field (a stray
 * "-" mid-edit, a paste gone wrong) shouldn't discard the rest of an
 * otherwise-valid patch or blow up the form (adversarial re-audit finding 5).
 */
export function updateSettings(
  account: PaperAccount,
  patch: Partial<PaperSettings>,
): PaperAccount {
  const settings = { ...account.settings };
  for (const key of Object.keys(SETTING_RANGES) as Array<keyof typeof SETTING_RANGES>) {
    const value = patch[key];
    if (isFiniteInRange(value, SETTING_RANGES[key])) settings[key] = value;
  }
  if (patch.defaultLeverage !== undefined) {
    // Reuses the same clamp a per-order leverage gets; a non-finite value
    // falls back to the previous default rather than being dropped, since
    // there's always a valid default to fall back to.
    settings.defaultLeverage = clampLeverage(patch.defaultLeverage, account.settings.defaultLeverage);
  }
  return { ...account, settings };
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
 * Relative floating-point tolerance for "is this position fully closed" —
 * relative rather than a flat epsilon so it scales with position size (a
 * fraction of a satoshi is real dust on a 10 BTC position but not on a
 * 0.0001 BTC one). Netting several fills against each other (see the fp-dust
 * regression test) can leave a remainder on the order of 1e-17 for a
 * qty ~0.1, which is what this needs to catch.
 */
const DUST_QTY_TOLERANCE = 1e-9;

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
  const remainder = position.qty - closedQty;
  // A remainder too small to represent a real position is folded into this
  // close rather than left behind as an untradeable, un-closeable dust row.
  const isDust = remainder > 0 && remainder <= position.qty * DUST_QTY_TOLERANCE;
  const fraction = isDust ? 1 : closedQty / position.qty;
  const releasedMargin = position.margin * fraction;
  const entryFeeShare = position.feesPaid * fraction;
  const exitFee = closedQty * exitPrice * feeRate;
  const grossPnl = pnlAtExit(
    position.entryPrice,
    exitPrice,
    closedQty,
    entrySide(position.side),
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

  return {
    balanceDelta: releasedMargin + grossPnl - exitFee,
    trade,
    position:
      remainder > 0 && !isDust
        ? {
            ...position,
            qty: remainder,
            margin: position.margin - releasedMargin,
            feesPaid: position.feesPaid - entryFeeShare,
          }
        : null,
  };
}

/**
 * Drop a bracket that sits on the wrong side of `price`, per the shared rule
 * in `paper-brackets.ts` (which the order ticket and the position editor use
 * to *explain* the same constraint). Called on every fill that can carry
 * brackets: a fresh open/flip (checked against the fill price, which *is*
 * entry there) and a same-side merge (checked against the fill price again,
 * not the blended entry, since a merge's incoming `args.tp`/`args.sl` — or
 * even its carried-over `sl`/`tp` — describes intent relative to *this*
 * fill, not to an entry the merge itself is about to move). Never called on
 * a pure reduce, which cannot introduce or change a bracket.
 */
function normalizeBrackets(
  dir: PaperDirection,
  price: number,
  tp: number | null,
  sl: number | null,
): { tp: number | null; sl: number | null } {
  const valid = bracketSidesValid(dir, price, tp, sl);
  return { tp: valid.tp ? tp : null, sl: valid.sl ? sl : null };
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
    feedSymbol: string | null;
    orderId: string | null;
    now: number;
  },
): EngineResult {
  const { symbol, side, qty, price, leverage, feeRate, orderId, now } = args;
  if (!isPositive(qty) || !isPositive(price)) {
    return reject(account, symbol, "Invalid quantity or price");
  }

  let balance = account.balance;
  let positions = account.positions;
  let history = account.history;
  // Set once the reducing leg below computes a trade; pushed to `events`
  // *after* the fill event that caused it (see the two returns below), not
  // as soon as it's known, so a close is always reported as a consequence of
  // a fill rather than the other way around.
  let closeEvent: PaperEvent | null = null;

  const existing = positions.find((p) => p.symbol === symbol) ?? null;
  let openQty = qty;

  // Opposite side: reduce, close, or flip before opening anything new.
  if (existing && side === closingSide(existing.side)) {
    const reduceQty = Math.min(qty, existing.qty);
    const slice = closeSlice(existing, reduceQty, price, feeRate, "MANUAL", now);
    const tentativeBalance = balance + slice.balanceDelta;
    // The reducing leg must never overdraw the account on its own, however
    // bad the fill price is (a crossing limit order now fills at the tick
    // that crossed it — see `evaluateTick` — so a violent gap tick can still
    // book a loss deeper than the position's own margin backs). Refuse the
    // whole fill rather than clamp it to a synthetic "worst affordable"
    // price: the caller's crossing loop already auto-cancels a resting order
    // that lands here (same as the margin check below), and the position is
    // left untouched for the ordinary per-tick liquidation check — which
    // *does* clamp, at the position's own computed liquidation price — to
    // settle on this same tick or the next one.
    if (tentativeBalance < -1e-9) {
      return reject(account, symbol, "Insufficient paper balance");
    }
    balance = tentativeBalance;
    positions = slice.position
      ? positions.map((p) => (p.id === existing.id ? slice.position! : p))
      : positions.filter((p) => p.id !== existing.id);
    history = [...history, slice.trade];
    closeEvent = { type: "close", symbol, reason: "MANUAL", trade: slice.trade };
    openQty = qty - reduceQty;
  }

  // A remainder too small to represent a real position (see
  // `DUST_QTY_TOLERANCE`): the reduce above already absorbed the whole
  // request in every way that matters, so don't flip into a dust-sized
  // position over it.
  if (openQty <= qty * DUST_QTY_TOLERANCE) {
    // Pure reduce: the exit fee is already inside the close event's
    // `trade.fees`, so the fill event reports zero rather than double-billing it.
    const events: PaperEvent[] = [{ type: "fill", orderId, symbol, side, qty, price, fee: 0 }];
    if (closeEvent) events.push(closeEvent);
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
    const totalMargin = sameSide.margin + margin;
    const entryPrice =
      (sameSide.entryPrice * sameSide.qty + price * openQty) / totalQty;
    // Re-validated against *this* fill's price, same as a fresh open below —
    // an incoming or carried-over bracket that no longer protects anything
    // relative to the current market is dropped rather than left to fire a
    // phantom gain (adversarial re-audit finding 2).
    const { tp, sl } = normalizeBrackets(
      sameSide.side,
      price,
      args.tp ?? sameSide.tp,
      args.sl ?? sameSide.sl,
    );
    const merged: PaperPosition = {
      ...sameSide,
      qty: totalQty,
      entryPrice,
      // Informational only: a blended figure so the position still shows
      // *a* leverage, but liquidation below is derived from the margin
      // actually locked, not from this number.
      leverage: totalMargin > 0 ? (totalQty * entryPrice) / totalMargin : leverage,
      margin: totalMargin,
      feesPaid: sameSide.feesPaid + fee,
      tp,
      sl,
      // A merge keeps the position's original feed identity — it's the same
      // symbol, and the incoming fill's own feedSymbol (if any) only fills a
      // gap left by an earlier direct-engine open with none.
      feedSymbol: sameSide.feedSymbol ?? args.feedSymbol,
      liquidationPrice: liquidationPriceFromMargin(
        sameSide.side,
        entryPrice,
        totalQty,
        totalMargin,
        account.settings.maintMarginRate,
      ),
    };
    positions = positions.map((p) => (p.id === sameSide.id ? merged : p));
  } else {
    const dir = directionOf(side);
    // A fresh position (a plain open, or the re-entry leg of a flip): drop
    // any bracket that sits on the wrong side of the fill price rather than
    // let it rest forever and eventually fire as a stop that books a gain.
    const { tp, sl } = normalizeBrackets(dir, price, args.tp ?? null, args.sl ?? null);
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
        tp,
        sl,
        feedSymbol: args.feedSymbol,
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

  // `qty` (not `openQty`) so a flip's single fill event still reports the
  // full requested size; `fee` here is only the opening leg's, per the
  // `PaperEvent["fee"]` doc — the reducing leg's fee is already counted in
  // `closeEvent`'s `trade.fees`.
  const events: PaperEvent[] = [{ type: "fill", orderId, symbol, side, qty, price, fee }];
  if (closeEvent) events.push(closeEvent);
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
    feedSymbol: req.feedSymbol ?? null,
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
    feedSymbol: req.feedSymbol ?? null,
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

/**
 * Flip `qty` (default: the whole position) from one side to the other in a
 * single netting fill: close it at `price`, pay the exit fee, then reopen the
 * same size on the opposite side at the same price and leverage, margined
 * fresh off that price — exactly what submitting an order of `2 * qty` on the
 * closing side does to `applyFill`'s existing netting logic (a `qty` equal to
 * the full position reduces it to zero and opens the remainder on the other
 * side; a smaller `qty` nets down to a smaller remainder on whichever side
 * ends up larger). Reusing that path rather than hand-rolling a close+open
 * pair is what keeps balance/margin consistent — a partial reverse that
 * cannot afford its reopened leg is rejected atomically, same as any other
 * fill. Brackets don't carry over, since TP/SL set for one direction usually
 * doesn't make sense for the other. A flat symbol (no position) is a no-op,
 * not a reject — there is nothing to reverse.
 */
export function reversePosition(
  account: PaperAccount,
  symbol: string,
  price: number,
  now: number,
  qty?: number,
): EngineResult {
  const position = account.positions.find((p) => p.symbol === symbol);
  if (!position || !isPositive(price)) return { account, events: [] };
  const reverseQty = qty === undefined ? position.qty : Math.min(qty, position.qty);
  if (!isPositive(reverseQty)) return { account, events: [] };

  return applyFill(account, {
    symbol,
    side: closingSide(position.side),
    qty: reverseQty * 2,
    price,
    leverage: position.leverage,
    feeRate: account.settings.takerFeeRate,
    tp: null,
    sl: null,
    feedSymbol: position.feedSymbol,
    orderId: null,
    now,
  });
}

/**
 * Attach or clear a position's brackets. Absent keys are left alone. Both
 * the resulting tp and sl are re-validated against `referencePrice` (the
 * caller's current mark for the symbol — the store passes the last live
 * tick; falls back to the position's own entry price when no mark is
 * available yet, e.g. right after a reload before the socket connects) so a
 * bracket typed in on the wrong side of the market is dropped rather than
 * left to fire an instant phantom-gain stop-out (adversarial re-audit
 * finding 2).
 */
export function setBrackets(
  account: PaperAccount,
  symbol: string,
  brackets: { tp?: number | null; sl?: number | null },
  referencePrice?: number,
): PaperAccount {
  const position = account.positions.find((p) => p.symbol === symbol);
  if (!position) return account;
  const candidateTp = brackets.tp === undefined ? position.tp : brackets.tp;
  const candidateSl = brackets.sl === undefined ? position.sl : brackets.sl;
  const ref = isPositive(referencePrice ?? NaN) ? (referencePrice as number) : position.entryPrice;
  const { tp, sl } = normalizeBrackets(position.side, ref, candidateTp, candidateSl);
  return {
    ...account,
    positions: account.positions.map((p) => (p.id === position.id ? { ...p, tp, sl } : p)),
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

  // The position on this symbol as it stood *before* this tick's limit
  // fills, id *and* brackets. Positions net per symbol, so there is at most
  // one; its id survives a same-side merge or a partial reduce, but not an
  // open or a flip. The bracket pass below uses the id to skip a fresh
  // position, and the tp/sl snapshot to skip a merge that changed the
  // brackets this same tick — see the comment down there.
  const preTickPosition = acc.positions.find((p) => p.symbol === symbol) ?? null;

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
      // The tick, not the order's own resting price: crossing guarantees
      // the tick is on the fill side of the limit, so filling at the tick is
      // the no-look-ahead choice — the order's own price could be wildly
      // stale (e.g. a limit resting far through the current market), and
      // filling there books a phantom gain or loss the market never offered
      // (adversarial re-audit finding 1).
      price,
      leverage: order.leverage,
      feeRate: acc.settings.makerFeeRate,
      tp: order.tp,
      sl: order.sl,
      feedSymbol: order.feedSymbol,
      orderId: order.id,
      now,
    });
    if (res.events.some((e) => e.type === "reject")) {
      // An order that can't be margined now never will be by sitting there
      // any longer — auto-cancel it instead of leaving it to reject (and
      // strand its reserve) on every future tick. `res.account` is `released`
      // unchanged: the reserve is already back in `balance` and the order
      // already dropped from `orders`.
      acc = res.account;
      events = [...events, ...res.events, { type: "cancel", orderId: order.id, symbol: order.symbol }];
      continue;
    }
    acc = res.account;
    events = [...events, ...res.events];
  }

  // Then brackets and liquidation, at most one trigger per position — but
  // never for a position this same tick just opened or flipped into: it has
  // no id in common with whatever (if anything) existed before the fills
  // above, so evaluating it here would price a stop/TP/liquidation off the
  // tick that created it rather than the next one. Nor for one whose tp/sl a
  // same-side merge just changed on this tick (the id survives a merge,
  // unlike an open/flip) — that bracket was only just set, relative to this
  // same tick's price, so it must wait for the next tick too, exactly like a
  // fresh position's (adversarial re-audit finding 3).
  const position = acc.positions.find((p) => p.symbol === symbol);
  const bracketsUnchangedThisTick =
    position !== undefined &&
    preTickPosition !== null &&
    position.id === preTickPosition.id &&
    position.tp === preTickPosition.tp &&
    position.sl === preTickPosition.sl;
  if (position && bracketsUnchangedThisTick) {
    const exit = triggeredExit(position, price);
    if (exit) {
      const res = closePosition(acc, symbol, exit.price, now, undefined, exit.reason);
      acc = res.account;
      events = [...events, ...res.events];
    }
  }

  return { account: acc, events };
}
