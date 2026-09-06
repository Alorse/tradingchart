"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import {
  DEFAULT_PAPER_SETTINGS,
  cancelOrder as engineCancelOrder,
  closePosition as engineClosePosition,
  createAccount,
  equity as engineEquity,
  evaluateTick as engineEvaluateTick,
  fillMarketOrder,
  placeLimitOrder as enginePlaceLimitOrder,
  reversePosition as engineReversePosition,
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
import { PNL_DISPLAY_MODES } from "@/lib/trading/paper-position-display";
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
 * `persist`'s wrapped `set` re-serializes the whole store to localStorage on
 * *every* call, regardless of whether the persisted slice actually changed —
 * see `partialize` below, which is just `{ account, pnlDisplayMode }`.
 * `evaluateTick` calls `set` on a mark-only tick too (a manual close or
 * `equity()` needs the fresh mark, so it can't just skip `set`), which would
 * otherwise mean a full JSON.stringify of positions/orders/history on every
 * live price update. Caching the last `account`/`pnlDisplayMode` actually
 * written and skipping the write when both are unchanged keeps that cost tied
 * to real mutations instead of ticks.
 */
function createPaperStorage(): PersistStorage<Persisted> {
  let lastAccount: PaperAccount | null = null;
  let lastMode: PnlDisplayMode | null = null;
  return {
    getItem: (name) => {
      const raw = globalThis.localStorage.getItem(name);
      return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
    },
    setItem: (name, value) => {
      if (value.state.account === lastAccount && value.state.pnlDisplayMode === lastMode) return;
      lastAccount = value.state.account;
      lastMode = value.state.pnlDisplayMode;
      globalThis.localStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => {
      // Drop the write-skip cache along with the blob: after a removal the
      // next write must land whatever the persisted slice's references are,
      // or storage silently stays empty until some unrelated mutation
      // happens to produce a fresh `account` object.
      lastAccount = null;
      lastMode = null;
      globalThis.localStorage.removeItem(name);
    },
  };
}

function isQuote(price: number | undefined): price is number {
  return price !== undefined && Number.isFinite(price) && price > 0;
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

const PAPER_DIRECTIONS = new Set(["LONG", "SHORT"]);
const PAPER_ORDER_SIDES = new Set(["BUY", "SELL"]);
const PAPER_ORDER_STATUSES = new Set(["NEW", "FILLED", "CANCELED"]);

/**
 * A persisted position/order/trade needs its money-math fields intact —
 * anything else (a stray `null` from a corrupted write, a field that lost its
 * type across a schema change) would crash `equity()`/`usedMargin()`, which
 * reduce over these arrays unconditionally, or silently rehydrate NaN
 * margin/fees into every calculation downstream (adversarial re-audit
 * finding 4).
 *
 * Every field the engine or a table actually *reads* is checked, not just the
 * headline numbers: a `qty <= 0` position is untradeable and un-closeable
 * (`closeSlice` divides by it), a `side` outside the direction enum inverts
 * every P&L sign through `pnlAtExit`, and a `reserved` that survived as a
 * string turns `usedMargin`'s `+` into string concatenation, poisoning equity
 * for the whole session (holistic review finding 3).
 */
function isValidPersistedPosition(p: unknown): p is PaperPosition {
  if (typeof p !== "object" || p === null) return false;
  const pos = p as Partial<PaperPosition>;
  return (
    isFiniteNumber(pos.qty) &&
    pos.qty > 0 &&
    isFiniteNumber(pos.margin) &&
    pos.margin >= 0 &&
    isFiniteNumber(pos.entryPrice) &&
    isFiniteNumber(pos.leverage) &&
    isFiniteNumber(pos.feesPaid) &&
    PAPER_DIRECTIONS.has(pos.side as string) &&
    isFiniteOrNull(pos.tp) &&
    isFiniteOrNull(pos.sl)
  );
}

function isValidPersistedOrder(o: unknown): o is PaperOrder {
  if (typeof o !== "object" || o === null) return false;
  const ord = o as Partial<PaperOrder>;
  return (
    isFiniteNumber(ord.price) &&
    isFiniteNumber(ord.qty) &&
    ord.qty > 0 &&
    isFiniteNumber(ord.reserved) &&
    PAPER_ORDER_SIDES.has(ord.side as string) &&
    PAPER_ORDER_STATUSES.has(ord.status as string)
  );
}

/** The fields the History table renders — a non-finite one shows up as
 *  "NaN USDT" in a row that can never be corrected. */
function isValidPersistedTrade(t: unknown): t is PaperTrade {
  if (typeof t !== "object" || t === null) return false;
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

/** Keeps a persisted settings key only when it survives as a finite number — a
 *  string or NaN left in place would rehydrate straight into every fee/margin
 *  calculation that reads `settings` (adversarial re-audit finding 4). */
function sanitizePersistedSettings(raw: unknown): Partial<PaperSettings> {
  if (typeof raw !== "object" || raw === null) return {};
  const settings = raw as Record<string, unknown>;
  const out: Partial<PaperSettings> = {};
  for (const key of Object.keys(DEFAULT_PAPER_SETTINGS) as (keyof PaperSettings)[]) {
    const value = settings[key];
    if (isFiniteNumber(value)) out[key] = value;
  }
  return out;
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
  if (typeof raw !== "object" || raw === null) return null;
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
  return {
    ...createAccount(),
    ...account,
    positions: account.positions.filter(isValidPersistedPosition),
    orders: account.orders.filter(isValidPersistedOrder),
    history: account.history.filter(isValidPersistedTrade),
    settings: {
      ...DEFAULT_PAPER_SETTINGS,
      ...sanitizePersistedSettings(account.settings),
    },
  } as PaperAccount;
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
        const quote = price ?? marks[req.symbol];
        if (!isQuote(quote)) return;
        const res = fillMarketOrder(account, req, quote, Date.now());
        set({
          account: res.account,
          // The fill price is a quote by definition, so it seeds the mark and
          // equity is meaningful before the first socket tick arrives.
          marks: marks[req.symbol] === quote ? marks : { ...marks, [req.symbol]: quote },
          lastEvents: res.events,
        });
      },

      placeLimitOrder: (req) => {
        const res = enginePlaceLimitOrder(get().account, req, Date.now());
        set({ account: res.account, lastEvents: res.events });
      },

      cancelOrder: (orderId) => {
        const res = engineCancelOrder(get().account, orderId, Date.now());
        set({ account: res.account, lastEvents: res.events });
      },

      closePosition: (symbol, price, qty) => {
        const { account, marks } = get();
        const quote = price ?? marks[symbol];
        if (!isQuote(quote)) return;
        const res = engineClosePosition(account, symbol, quote, Date.now(), qty);
        set({ account: res.account, lastEvents: res.events });
      },

      reversePosition: (symbol, price, qty) => {
        const { account, marks } = get();
        const quote = price ?? marks[symbol];
        if (!isQuote(quote)) return;
        const res = engineReversePosition(account, symbol, quote, Date.now(), qty);
        set({ account: res.account, lastEvents: res.events });
      },

      setPnlDisplayMode: (mode) => set({ pnlDisplayMode: mode }),

      setBrackets: (symbol, brackets) => {
        const { account, marks } = get();
        // The last live tick, so a bracket typed in on the wrong side of the
        // *current* market is dropped, not just the wrong side of a stale
        // entry price (adversarial re-audit finding 2). Falls back to entry
        // inside the engine when no tick has arrived yet.
        const next = engineSetBrackets(account, symbol, brackets, marks[symbol]);
        set({ account: next });
      },

      evaluateTick: (symbol, price) => {
        if (!Number.isFinite(price) || price <= 0) return;
        const { account, marks } = get();
        // The cheap path, and by far the common one: a tick for a symbol the
        // paper account has no exposure to costs two `some` scans and no
        // allocation at all, so mounting this on a live socket is free.
        const relevant =
          account.positions.some((p) => p.symbol === symbol) ||
          account.orders.some((o) => o.symbol === symbol);
        if (!relevant) return;

        const nextMarks = marks[symbol] === price ? marks : { ...marks, [symbol]: price };
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
      // Going through `globalThis.localStorage` (rather than `window`) is
      // identical in the browser and is what lets the offline `node --test`
      // suite exercise this round trip for real.
      storage: createPaperStorage(),
      // Account and the P&L display preference survive a reload; marks and
      // events are session data.
      partialize: (s) => ({ account: s.account, pnlDisplayMode: s.pnlDisplayMode }),
      /**
       * Defensive merge: a blob written before a settings key existed (or a
       * corrupted one) must not leave the account half-built, since every fee
       * and margin calculation reads off `settings`. Beyond the top-level
       * shape, every array item and every settings value is validated
       * individually (adversarial re-audit finding 4) — a single bad
       * position/order/setting is dropped rather than sinking the whole
       * account back to `current`, since the rest of a mostly-intact blob is
       * still worth keeping. A `pnlDisplayMode` outside the known enum (a
       * stale value from before a mode was renamed, or a hand-edited blob)
       * falls back to the current default instead of rendering an unmapped
       * unit as blank.
       */
      merge: (persisted, current) => {
        const raw = persisted as { account?: unknown; pnlDisplayMode?: unknown } | undefined;
        const account = sanitizePaperAccount(raw?.account);
        const pnlDisplayMode = PNL_DISPLAY_MODES.includes(raw?.pnlDisplayMode as PnlDisplayMode)
          ? (raw!.pnlDisplayMode as PnlDisplayMode)
          : current.pnlDisplayMode;
        return { ...current, ...(account ? { account } : {}), pnlDisplayMode };
      },
    },
  ),
);

/**
 * Clears the persisted paper blob through `persist`'s own storage handle
 * (`createPaperStorage` above) rather than reaching for
 * `localStorage.removeItem(PAPER_STORAGE_KEY)` directly — a hand-rolled
 * removal leaves that storage's write-skip cache pointing at a blob that no
 * longer exists, so the next `set` whose persisted slice is
 * reference-identical short-circuits and storage stays empty.
 *
 * Used by the sign-out / user-switch wipe in `use-paper-account-sync.ts`.
 */
export function clearPersistedPaperAccount() {
  usePaperTradingStore.persist.clearStorage();
}
