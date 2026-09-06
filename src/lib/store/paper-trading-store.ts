"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage } from "zustand/middleware";
import { localStoragePersist } from "@/lib/store/persist-storage";
import {
  DEFAULT_PAPER_SETTINGS,
  cancelOrder as engineCancelOrder,
  closePosition as engineClosePosition,
  createAccount,
  equity as engineEquity,
  evaluateTick as engineEvaluateTick,
  fillMarketOrder,
  isPositive,
  placeLimitOrder as enginePlaceLimitOrder,
  reversePosition as engineReversePosition,
  sanitizePersistedSettings,
  setBrackets as engineSetBrackets,
  updateSettings as engineUpdateSettings,
} from "@/lib/trading/paper-engine";
import type {
  LimitOrderRequest,
  MarketOrderRequest,
  PaperAccount,
  PaperEvent,
  PaperOrder,
  PaperPosition,
  PaperSettings,
  PaperTrade,
} from "@/lib/trading/paper-engine";
import { isPnlDisplayMode } from "@/lib/trading/paper-position-display";
import type { PnlDisplayMode } from "@/lib/trading/paper-position-display";

/**
 * Simulated trading account: a thin stateful shell over the pure engine in
 * [paper-engine.ts](../trading/paper-engine.ts). Every action funnels a store
 * snapshot through an engine call and writes the returned account back — no
 * money math lives here, which is what keeps the engine testable on its own.
 *
 * Deliberately **not** wired to `trading-store`: paper and live accounts share
 * no state, so a simulated position can never leak into the credential-backed
 * panels (or the other way round).
 *
 * Single-tab only: `persist`'s localStorage backing is last-write-wins across
 * tabs/windows, with no cross-tab broadcast, so two tabs trading the same
 * paper account can silently stomp each other's state. Real multi-device
 * consistency needs a server-authoritative store (Supabase sync, tracked
 * under #9) rather than a localStorage patch — not attempted here.
 */

export const PAPER_STORAGE_KEY = "tv-gratis-paper-trading";

interface PaperTradingState {
  account: PaperAccount;
  /**
   * Last price seen per symbol. Session-only and deliberately outside `persist`
   * — a mark from yesterday is worse than no mark at all, and rehydrating one
   * would show a stale unrealized P&L before the socket connects.
   */
  marks: Record<string, number>;
  /** Events from the most recent action, for a future toast/journal surface.
   *  Replaced rather than appended, so it can't grow over a long session. */
  lastEvents: PaperEvent[];
  /** How a position's floating P&L is displayed across the panel/chart —
   *  Money/Ticks/Percentage. ROE% is a separate, always-present column and
   *  isn't affected by this. Persisted like the account, since it's a user
   *  preference rather than session state. */
  pnlDisplayMode: PnlDisplayMode;

  /** Market order: fills at `price`, or at the symbol's last mark if omitted. */
  placeOrder: (req: MarketOrderRequest, price?: number) => void;
  placeLimitOrder: (req: LimitOrderRequest) => void;
  cancelOrder: (orderId: string) => void;
  /** Closes at `price`, or at the symbol's last mark. `qty` closes part of it. */
  closePosition: (symbol: string, price?: number, qty?: number) => void;
  /** Flips `qty` (default: the whole position) to the opposite side at
   *  `price`, or at the symbol's last mark. See engine `reversePosition`. */
  reversePosition: (symbol: string, price?: number, qty?: number) => void;
  setBrackets: (symbol: string, brackets: { tp?: number | null; sl?: number | null }) => void;
  setPnlDisplayMode: (mode: PnlDisplayMode) => void;
  /** Drive fills and bracket triggers off one live tick. Safe on every WS message. */
  evaluateTick: (symbol: string, price: number) => void;
  resetAccount: () => void;
  /** Replaces the whole account wholesale — the cloud-sync hook's "cloud wins
   *  on load" adoption path. Not for in-app mutations; those go through the
   *  engine actions above so history/undo stays consistent. */
  setAccount: (account: PaperAccount) => void;
  updateSettings: (patch: Partial<PaperSettings>) => void;
  /** Free balance + locked margin + open P&L, valued at the current marks. */
  equity: () => number;
}

type Persisted = { account: PaperAccount; pnlDisplayMode: PnlDisplayMode };

/**
 * The shared localStorage backing, plus one extra layer: skip a write whose
 * persisted slice is identical to the last one written.
 *
 * `persist`'s wrapped `set` re-serializes the whole store on *every* call,
 * regardless of whether the persisted slice actually changed — and `marks`
 * lives in this same store, so `evaluateTick` reaches `set` on a mark-only
 * tick too (a manual close or `equity()` needs the fresh mark). Without the
 * cache that would mean a full JSON.stringify of positions/orders/history on
 * every live price update. Moving `marks` into a store of its own would fix
 * it at the source; until then, comparing `account`/`pnlDisplayMode` by
 * identity keeps the write cost tied to real mutations instead of ticks.
 */
function createPaperStorage(): PersistStorage<Persisted> | undefined {
  const base = localStoragePersist<Persisted>();
  if (!base) return undefined;
  let lastAccount: PaperAccount | null = null;
  let lastMode: PnlDisplayMode | null = null;
  return {
    ...base,
    setItem: (name, value) => {
      if (value.state.account === lastAccount && value.state.pnlDisplayMode === lastMode) return;
      lastAccount = value.state.account;
      lastMode = value.state.pnlDisplayMode;
      base.setItem(name, value);
    },
  };
}

function isQuote(price: number | undefined): price is number {
  return price !== undefined && isPositive(price);
}

/**
 * The price a manual action should transact at: the caller's explicit price if
 * it gave one, else the symbol's last live mark. `null` when neither is a
 * usable quote, which is every such action's bail-out condition.
 */
function quoteFor(
  marks: Record<string, number>,
  symbol: string,
  price?: number,
): number | null {
  const quote = price ?? marks[symbol];
  return isQuote(quote) ? quote : null;
}

/**
 * `marks` with `symbol` marked at `price`, reusing the existing object when
 * the value is unchanged — a repeated tick must not hand subscribers a fresh
 * identity and re-render them.
 */
function withMark(
  marks: Record<string, number>,
  symbol: string,
  price: number,
): Record<string, number> {
  return marks[symbol] === price ? marks : { ...marks, [symbol]: price };
}

/** Narrows an unknown persisted blob to something with readable fields. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** A bracket is either off (`null`) or a real price — never `undefined`, a
 *  string, or NaN, all of which compare `!== null` and would then be silently
 *  tested against a live price by `triggeredExit`. */
function isFiniteOrNull(n: unknown): n is number | null {
  return n === null || isFiniteNumber(n);
}

// Typed as `unknown` sets on purpose: they are handed fields off an unvalidated
// blob, so `has` should accept whatever is there rather than force a cast.
const PAPER_DIRECTIONS: ReadonlySet<unknown> = new Set(["LONG", "SHORT"]);
const PAPER_ORDER_SIDES: ReadonlySet<unknown> = new Set(["BUY", "SELL"]);
const PAPER_ORDER_STATUSES: ReadonlySet<unknown> = new Set(["NEW", "FILLED", "CANCELED"]);

/**
 * A persisted position/order/trade needs its money-math fields intact —
 * anything else (a stray `null` from a corrupted write, a field that lost its
 * type across a schema change) would crash `equity()`/`usedMargin()`, which
 * reduce over these arrays unconditionally, or silently rehydrate NaN
 * margin/fees into every calculation downstream.
 *
 * Every field the engine or a table actually *reads* is checked, not just the
 * headline numbers: a `qty <= 0` position is untradeable and un-closeable
 * (`closeSlice` divides by it), a `side` outside the direction enum inverts
 * every P&L sign through `pnlAtExit`, and a `reserved` that survived as a
 * string turns `usedMargin`'s `+` into string concatenation, poisoning equity
 * for the whole session.
 */
function isValidPersistedPosition(p: unknown): p is PaperPosition {
  if (!isRecord(p)) return false;
  const pos = p as Partial<PaperPosition>;
  return (
    isFiniteNumber(pos.qty) &&
    pos.qty > 0 &&
    isFiniteNumber(pos.margin) &&
    pos.margin >= 0 &&
    isFiniteNumber(pos.entryPrice) &&
    isFiniteNumber(pos.leverage) &&
    isFiniteNumber(pos.feesPaid) &&
    PAPER_DIRECTIONS.has(pos.side) &&
    isFiniteOrNull(pos.tp) &&
    isFiniteOrNull(pos.sl)
  );
}

function isValidPersistedOrder(o: unknown): o is PaperOrder {
  if (!isRecord(o)) return false;
  const ord = o as Partial<PaperOrder>;
  return (
    isFiniteNumber(ord.price) &&
    isFiniteNumber(ord.qty) &&
    ord.qty > 0 &&
    isFiniteNumber(ord.reserved) &&
    PAPER_ORDER_SIDES.has(ord.side) &&
    PAPER_ORDER_STATUSES.has(ord.status)
  );
}

/** The fields the History table renders — a non-finite one shows up as
 *  "NaN USDT" in a row that can never be corrected. */
function isValidPersistedTrade(t: unknown): t is PaperTrade {
  if (!isRecord(t)) return false;
  const trade = t as Partial<PaperTrade>;
  return (
    isFiniteNumber(trade.realizedPnl) &&
    isFiniteNumber(trade.fees) &&
    isFiniteNumber(trade.roi) &&
    isFiniteNumber(trade.qty) &&
    isFiniteNumber(trade.entryPrice) &&
    isFiniteNumber(trade.exitPrice)
  );
}

/** True while the account still looks exactly as it was seeded. */
function isUntouched(account: PaperAccount): boolean {
  return (
    account.positions.length === 0 &&
    account.orders.length === 0 &&
    account.history.length === 0
  );
}

/**
 * Validates and repairs an arbitrary blob into a `PaperAccount`, or returns
 * `null` if it isn't shaped like one at all. Shared by the localStorage
 * `merge` below and `loadPaperAccount` (src/lib/supabase/paper-account-data.ts)
 * so a corrupt cloud row is rejected with the exact same rules as a corrupt
 * localStorage blob, rather than a second hand-rolled check drifting from
 * this one over time.
 */
export function sanitizePaperAccount(raw: unknown): PaperAccount | null {
  if (!isRecord(raw)) return null;
  const account = raw as Partial<PaperAccount>;
  if (
    !Array.isArray(account.positions) ||
    !Array.isArray(account.orders) ||
    !Array.isArray(account.history) ||
    !isFiniteNumber(account.balance) ||
    // Free cash can be exactly zero (fully deployed) but never negative: the
    // engine refuses any fill that would overdraw, so a negative balance means
    // the blob is corrupt rather than merely unlucky.
    account.balance < 0
  ) {
    return null;
  }
  // Built field by field rather than spread over a seed account: `PaperAccount`
  // is closed and every one of its five fields is written here, so a spread
  // only carried the blob's stray keys forward — which is exactly what forced
  // the `as PaperAccount` cast that stopped TypeScript checking this return.
  return {
    balance: account.balance,
    positions: account.positions.filter(isValidPersistedPosition),
    orders: account.orders.filter(isValidPersistedOrder),
    history: account.history.filter(isValidPersistedTrade),
    settings: {
      ...DEFAULT_PAPER_SETTINGS,
      ...sanitizePersistedSettings(account.settings),
    },
  };
}

export const usePaperTradingStore = create<PaperTradingState>()(
  persist(
    (set, get) => ({
      account: createAccount(),
      marks: {},
      lastEvents: [],
      pnlDisplayMode: "MONEY",

      placeOrder: (req, price) => {
        const { account, marks } = get();
        const quote = quoteFor(marks, req.symbol, price);
        if (quote === null) return;
        const res = fillMarketOrder(account, req, quote, Date.now());
        set({
          account: res.account,
          // The fill price is a quote by definition, so it seeds the mark and
          // equity is meaningful before the first socket tick arrives.
          marks: withMark(marks, req.symbol, quote),
          lastEvents: res.events,
        });
      },

      placeLimitOrder: (req) => {
        const res = enginePlaceLimitOrder(get().account, req, Date.now());
        set({ account: res.account, lastEvents: res.events });
      },

      cancelOrder: (orderId) => {
        const res = engineCancelOrder(get().account, orderId);
        set({ account: res.account, lastEvents: res.events });
      },

      closePosition: (symbol, price, qty) => {
        const { account, marks } = get();
        const quote = quoteFor(marks, symbol, price);
        if (quote === null) return;
        const res = engineClosePosition(account, symbol, quote, Date.now(), qty);
        set({ account: res.account, lastEvents: res.events });
      },

      reversePosition: (symbol, price, qty) => {
        const { account, marks } = get();
        const quote = quoteFor(marks, symbol, price);
        if (quote === null) return;
        const res = engineReversePosition(account, symbol, quote, Date.now(), qty);
        set({ account: res.account, lastEvents: res.events });
      },

      setPnlDisplayMode: (mode) => set({ pnlDisplayMode: mode }),

      setBrackets: (symbol, brackets) => {
        const { account, marks } = get();
        // The last live tick, so a bracket typed in on the wrong side of the
        // *current* market is dropped, not just the wrong side of a stale
        // entry price. Falls back to entry inside the engine when no tick
        // has arrived yet.
        const next = engineSetBrackets(account, symbol, brackets, marks[symbol]);
        set({ account: next });
      },

      evaluateTick: (symbol, price) => {
        if (!isPositive(price)) return;
        const { account, marks } = get();
        // The cheap path, and by far the common one: a tick for a symbol the
        // paper account has no exposure to costs two `some` scans and no
        // allocation at all, so mounting this on a live socket is free.
        const relevant =
          account.positions.some((p) => p.symbol === symbol) ||
          account.orders.some((o) => o.symbol === symbol);
        if (!relevant) return;

        const nextMarks = withMark(marks, symbol, price);
        const res = engineEvaluateTick(account, symbol, price, Date.now());
        // Identical price, nothing triggered: leave every reference alone so
        // subscribed components don't re-render on a repeated tick. A tick
        // that only moves the mark still needs to reach `set` (a manual close
        // or `equity()` reads that value), but `createPaperStorage` above
        // recognizes `account` hasn't changed and skips the actual write —
        // `marks` is session-only and was never part of the persisted blob.
        if (res.account === account && nextMarks === marks) return;
        if (res.events.length > 0) {
          set({ account: res.account, marks: nextMarks, lastEvents: res.events });
        } else {
          set({ account: res.account, marks: nextMarks });
        }
      },

      /**
       * Start over. This is a *factory* reset — settings go back to their
       * defaults alongside the balance, unlike the engine's `resetAccount`,
       * which preserves them. It's the escape hatch for an account whose fees
       * or seed have been fiddled into something unusable.
       */
      resetAccount: () => set({ account: createAccount(), marks: {}, lastEvents: [] }),

      setAccount: (account) => set({ account }),

      updateSettings: (patch) => {
        const account = engineUpdateSettings(get().account, patch);
        // Changing the seed on an account that has never traded re-seeds it;
        // once there's a position, an order or a closed trade, the balance is
        // history and only future resets pick the new number up.
        const reseed = patch.seedBalance !== undefined && isUntouched(account);
        set({ account: reseed ? { ...account, balance: account.settings.seedBalance } : account });
      },

      equity: () => {
        const { account, marks } = get();
        return engineEquity(account, marks);
      },
    }),
    {
      name: PAPER_STORAGE_KEY,
      version: 1,
      storage: createPaperStorage(),
      // Account and the P&L display preference survive a reload; marks and
      // events are session data.
      partialize: (s) => ({ account: s.account, pnlDisplayMode: s.pnlDisplayMode }),
      /**
       * Defensive merge: a blob written before a settings key existed (or a
       * corrupted one) must not leave the account half-built, since every fee
       * and margin calculation reads off `settings`. Beyond the top-level
       * shape, every array item and every settings value is validated
       * individually — a single bad position/order/setting is dropped
       * rather than sinking the whole
       * account back to `current`, since the rest of a mostly-intact blob is
       * still worth keeping. A `pnlDisplayMode` outside the known enum (a
       * stale value from before a mode was renamed, or a hand-edited blob)
       * falls back to the current default instead of rendering an unmapped
       * unit as blank.
       */
      merge: (persisted, current) => {
        const raw = persisted as { account?: unknown; pnlDisplayMode?: unknown } | undefined;
        const account = sanitizePaperAccount(raw?.account);
        const pnlDisplayMode = isPnlDisplayMode(raw?.pnlDisplayMode)
          ? raw.pnlDisplayMode
          : current.pnlDisplayMode;
        return { ...current, ...(account ? { account } : {}), pnlDisplayMode };
      },
    },
  ),
);
