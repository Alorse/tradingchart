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
} from "@/lib/trading/paper-engine";

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

  /** Market order: fills at `price`, or at the symbol's last mark if omitted. */
  placeOrder: (req: MarketOrderRequest, price?: number) => void;
  placeLimitOrder: (req: LimitOrderRequest) => void;
  cancelOrder: (orderId: string) => void;
  /** Closes at `price`, or at the symbol's last mark. `qty` closes part of it. */
  closePosition: (symbol: string, price?: number, qty?: number) => void;
  setBrackets: (symbol: string, brackets: { tp?: number | null; sl?: number | null }) => void;
  /** Drive fills and bracket triggers off one live tick. Safe on every WS message. */
  evaluateTick: (symbol: string, price: number) => void;
  resetAccount: () => void;
  updateSettings: (patch: Partial<PaperSettings>) => void;
  /** Free balance + locked margin + open P&L, valued at the current marks. */
  equity: () => number;
}

type Persisted = { account: PaperAccount };

/**
 * `persist`'s wrapped `set` re-serializes the whole store to localStorage on
 * *every* call, regardless of whether the persisted slice actually changed —
 * see `partialize` below, which is just `{ account }`. `evaluateTick` calls
 * `set` on a mark-only tick too (a manual close or `equity()` needs the fresh
 * mark, so it can't just skip `set`), which would otherwise mean a full
 * JSON.stringify of positions/orders/history on every live price update.
 * Caching the last `account` reference actually written and skipping the
 * write when it's unchanged keeps that cost tied to real account mutations
 * instead of ticks.
 */
function createPaperStorage(): PersistStorage<Persisted> {
  let lastAccount: PaperAccount | null = null;
  return {
    getItem: (name) => {
      const raw = globalThis.localStorage.getItem(name);
      return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
    },
    setItem: (name, value) => {
      if (value.state.account === lastAccount) return;
      lastAccount = value.state.account;
      globalThis.localStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => globalThis.localStorage.removeItem(name),
  };
}

function isQuote(price: number | undefined): price is number {
  return price !== undefined && Number.isFinite(price) && price > 0;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * A persisted position/order needs its money-math fields intact — anything
 * else (a stray `null` from a corrupted write, a field that lost its type
 * across a schema change) would crash `equity()`/`usedMargin()`, which
 * reduce over these arrays unconditionally, or silently rehydrate NaN
 * margin/fees into every calculation downstream (adversarial re-audit
 * finding 4).
 */
function isValidPersistedPosition(p: unknown): p is PaperPosition {
  if (typeof p !== "object" || p === null) return false;
  const pos = p as Partial<PaperPosition>;
  return isFiniteNumber(pos.qty) && isFiniteNumber(pos.entryPrice) && isFiniteNumber(pos.margin);
}

function isValidPersistedOrder(o: unknown): o is PaperOrder {
  if (typeof o !== "object" || o === null) return false;
  const ord = o as Partial<PaperOrder>;
  return isFiniteNumber(ord.price) && isFiniteNumber(ord.qty);
}

function isValidPersistedTrade(t: unknown): boolean {
  return typeof t === "object" && t !== null;
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

export const usePaperTradingStore = create<PaperTradingState>()(
  persist(
    (set, get) => ({
      account: createAccount(),
      marks: {},
      lastEvents: [],

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
      // Only the account survives a reload; marks and events are session data.
      partialize: (s) => ({ account: s.account }),
      /**
       * Defensive merge: a blob written before a settings key existed (or a
       * corrupted one) must not leave the account half-built, since every fee
       * and margin calculation reads off `settings`. Beyond the top-level
       * shape, every array item and every settings value is validated
       * individually (adversarial re-audit finding 4) — a single bad
       * position/order/setting is dropped rather than sinking the whole
       * account back to `current`, since the rest of a mostly-intact blob is
       * still worth keeping.
       */
      merge: (persisted, current) => {
        const account = (persisted as { account?: Partial<PaperAccount> } | undefined)?.account;
        if (
          !account ||
          !Array.isArray(account.positions) ||
          !Array.isArray(account.orders) ||
          !Array.isArray(account.history) ||
          !isFiniteNumber(account.balance)
        ) {
          return current;
        }
        return {
          ...current,
          account: {
            ...createAccount(),
            ...account,
            positions: account.positions.filter(isValidPersistedPosition),
            orders: account.orders.filter(isValidPersistedOrder),
            history: account.history.filter(isValidPersistedTrade),
            settings: {
              ...DEFAULT_PAPER_SETTINGS,
              ...sanitizePersistedSettings(account.settings),
            },
          } as PaperAccount,
        };
      },
    },
  ),
);
