"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isPerp, cleanSym } from "@/lib/binance/rest";
import { useChartStore } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { useToastStore } from "@/lib/alerts/toast-store";
import { tradeGate } from "@/lib/trading/exchange-gate";
import { hedgePositionIdx, remainingQty } from "@/lib/trading/hedge";
import type {
  Order,
  Position,
  AssetBalance,
  OrderSide,
  OrderType,
  TimeInForce,
  PlaceOrderParams,
  SizingMode,
  SlMode,
  Exchange,
} from "@/lib/binance/trading-types";

export interface OrderForm {
  side: OrderSide;
  type: OrderType;
  /** LIMIT / STOP_LIMIT price. */
  price: string;
  /** STOP_MARKET / STOP_LIMIT trigger price. */
  stopPrice: string;
  /** Canonical quantity in base asset (e.g. BTC). Single source of truth. */
  qty: string;
  /** Currently selected sizing mode. Determines which input is editable. */
  sizingMode: SizingMode;
  /**
   * Raw text of the editable sizing input (parsed lazily), in whatever unit
   * `sizingMode` selects. In the risk modes this is the risk budget, and it is
   * the value held fixed: moving the stop re-sizes the position rather than
   * changing how much is at stake.
   */
  sizingInput: string;
  slEnabled: boolean;
  /** Canonical stop-loss PRICE. `slMode` only changes how it's entered. */
  sl: string;
  /** Unit the stop-loss field is typed in (price, % of price, risk USD, risk %). */
  slMode: SlMode;
  tpEnabled: boolean;
  tp: string;
  timeInForce: TimeInForce;
  reduceOnly: boolean;
  /** Leverage mirrored from the exchange. Editable via setLeverage(). */
  leverage: number;
}

interface TradingState {
  // Credentials
  exchange: Exchange;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  isConnected: boolean;

  // Data
  orders: Order[];
  positions: Position[];
  balance: AssetBalance[];
  /** Every open perp position on the account, regardless of the chart's
   *  current symbol — unlike `positions`, which `fetchPositions(symbol)` scopes
   *  to a single symbol. Used by the watchlist to badge any row with an open
   *  trade. Refreshed by the global useTradingSync poll. */
  allPositions: Position[];

  // UI form
  form: OrderForm;
  tradingPanelOpen: boolean;
  /** When true, the API-credentials dialog is open. Lifted from local state
   *  in OrderPanel so mobile screens can also open it. */
  apiKeyDialogOpen: boolean;
  isLoading: boolean;
  lastError: string | null;
  /** OrderId currently being modified via drag-to-modify on the chart. */
  modifyingOrderId: number | string | null;
  /** Position shown in the typed TP/SL editor — opened by right-clicking the
   *  position's SL/TP line on the chart, rendered by `OrderPanel` in place of
   *  the normal order form. An alternative to the drag → pending → Confirm
   *  flow for when you want to type an exact price instead of dragging. */
  editingPosition: { symbol: string; position: Position } | null;

  // Actions
  setExchange: (exchange: Exchange) => void;
  setCredentials: (apiKey: string, apiSecret: string, testnet: boolean) => void;
  setConnected: (v: boolean) => void;
  setTradingPanelOpen: (v: boolean) => void;
  setApiKeyDialogOpen: (v: boolean) => void;
  /** Opens the typed TP/SL editor for `position` and switches the right
   *  sidebar / mobile shell to the Trade tab so it's actually visible. */
  openPositionEdit: (symbol: string, position: Position) => void;
  closePositionEdit: () => void;
  updateForm: (patch: Partial<OrderForm>) => void;
  resetForm: (price?: number) => void;

  fetchBalance: (symbol: string) => Promise<void>;
  fetchOrders: (symbol: string) => Promise<void>;
  fetchPositions: (symbol: string) => Promise<void>;
  /** Fetch every open perp position on the account into `allPositions`. */
  fetchAllPositions: () => Promise<void>;
  /** Derives `positions` (scoped to `symbol`) from the already-fetched
   *  `allPositions` instead of issuing a second network request — used by the
   *  polling loop, which already fetches the whole account every tick. */
  syncPositionsFromAll: (symbol: string) => void;
  /**
   * Refresh balance + orders + positions in a **single** request to
   * `/api/trade/sync`, then derive the symbol-scoped `positions` locally.
   * This is what the polling loop uses: one Vercel Function invocation per
   * tick instead of three (plus three middleware runs). The per-resource
   * `fetch*` actions above remain for one-off post-action refreshes.
   */
  syncAccount: (symbol: string) => Promise<void>;

  placeOrder: (
    symbol: string,
    overrides?: Partial<OrderForm>,
  ) => Promise<{ ok: boolean; error?: string }>;
  cancelOrder: (symbol: string, orderId: number | string) => Promise<void>;
  /** Cancel an existing order and immediately re-post it with the given
   *  overrides (price/stopPrice depending on type, and/or quantity). Used by
   *  drag-to-modify on the chart and by the Orders table's edit popover. */
  modifyOrder: (
    symbol: string,
    order: Order,
    patch: { price?: number; quantity?: number },
  ) => Promise<{ ok: boolean; error?: string }>;
  /** POST to /api/trade/leverage to sync the exchange leverage. */
  setLeverage: (
    symbol: string,
    leverage: number,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Close an open position with a reduceOnly MARKET order. */
  closePosition: (
    symbol: string,
    position: Position,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Place a reduceOnly TP and/or SL for an existing position. Cancels any
   *  matching existing reduceOnly order before placing the new one. */
  setPositionTpSl: (
    symbol: string,
    position: Position,
    args: { tp?: number | null; sl?: number | null },
  ) => Promise<{ ok: boolean; error?: string }>;
}

function defaultForm(): OrderForm {
  return {
    side: "BUY",
    type: "LIMIT",
    price: "",
    stopPrice: "",
    qty: "",
    sizingMode: "AMOUNT",
    sizingInput: "",
    slEnabled: false,
    sl: "",
    slMode: "PRICE",
    tpEnabled: false,
    tp: "",
    timeInForce: "GTC",
    reduceOnly: false,
    leverage: 10,
  };
}

/**
 * Normalize the raw open-orders payload. Binance returns its own shape with
 * numeric fields as strings; the Bybit mapper already emits the same field
 * names with real numbers — `parseFloat` is a no-op on those, so one mapper
 * covers both. Shared by `fetchOrders` and `syncAccount`.
 */
function mapRawOrders(data: unknown, perp: boolean): Order[] {
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((o) => ({
    orderId: o.orderId as number,
    clientOrderId: o.clientOrderId as string,
    symbol: o.symbol as string,
    side: o.side as Order["side"],
    type: o.type as Order["type"],
    status: o.status as Order["status"],
    price: parseFloat(o.price as string),
    origQty: parseFloat(o.origQty as string),
    executedQty: parseFloat(o.executedQty as string),
    stopPrice: o.stopPrice ? parseFloat(o.stopPrice as string) : undefined,
    timeInForce: o.timeInForce as Order["timeInForce"],
    time: o.time as number,
    updateTime: o.updateTime as number,
    reduceOnly: (o.reduceOnly as boolean) ?? false,
    isPerp: perp,
    positionIdx: typeof o.positionIdx === "number" ? o.positionIdx : undefined,
  }));
}

/**
 * POST an order and actually read the outcome.
 *
 * `fetch` only rejects on a network-layer failure: an exchange rejection
 * (invalid stop price, "would trigger immediately", minNotional, rate limit)
 * arrives as a perfectly ordinary 400 that an unchecked `await fetch(...)`
 * discards. That is how a protective stop could fail while the app reported
 * success, leaving a leveraged position unprotected and unannounced.
 *
 * Both venues surface failures the same way through `/api/trade/order`, so one
 * check covers them: Binance's error status and body are forwarded verbatim,
 * and Bybit's non-zero `retCode` — which the exchange itself returns inside an
 * HTTP 200 envelope — is converted to a 400 with a `msg` by the route.
 */
async function postOrder(body: PlaceOrderParams): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/trade/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { msg?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.msg ?? data.error ?? "Order failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Shape returned by `/api/trade/sync` for each of its three reads. */
interface SyncSlot<T> {
  data: T | null;
  error: unknown | null;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
      exchange: "binance",
      apiKey: "",
      apiSecret: "",
      testnet: true,
      isConnected: false,
      orders: [],
      positions: [],
      allPositions: [],
      balance: [],
      form: defaultForm(),
      tradingPanelOpen: false,
      apiKeyDialogOpen: false,
      isLoading: false,
      lastError: null,
      modifyingOrderId: null,
      editingPosition: null,

      setExchange: (exchange) => {
        // Switching exchange invalidates the current connection + cached data.
        set({ exchange, isConnected: false, orders: [], positions: [], allPositions: [], balance: [] });
      },
      setCredentials: (apiKey, apiSecret, testnet) => {
        set({ apiKey, apiSecret, testnet, isConnected: false, lastError: null });
      },
      setConnected: (v) => set({ isConnected: v }),
      setTradingPanelOpen: (v) => set({ tradingPanelOpen: v }),
      openPositionEdit: (symbol, position) => {
        set({ editingPosition: { symbol, position } });
        useChartStore.getState().setRightSidebarTab("trade");
        useMobileStore.getState().setTab("trade");
      },
      closePositionEdit: () => set({ editingPosition: null }),
      setApiKeyDialogOpen: (v) => set({ apiKeyDialogOpen: v }),
      updateForm: (patch) =>
        set((s) => ({ form: { ...s.form, ...patch } })),
      resetForm: (price) =>
        set((s) => ({
          form: {
            ...defaultForm(),
            // Preserve user's leverage & input-unit preferences across resets.
            leverage: s.form.leverage,
            sizingMode: s.form.sizingMode,
            slMode: s.form.slMode,
            price: price ? String(price) : "",
          },
        })),

      fetchBalance: async (symbol) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return;
        const perp = isPerp(symbol);
        const params = new URLSearchParams({
          apiKey,
          apiSecret,
          testnet: String(testnet),
          isPerp: String(perp),
          exchange,
        });
        try {
          const res = await fetch(`/api/trade/balance?${params}`);
          if (!res.ok) return;
          const data = await res.json();
          set({ balance: data, isConnected: true });
        } catch {
          set({ isConnected: false });
        }
      },

      fetchOrders: async (symbol) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return;
        const perp = isPerp(symbol);
        const sym = cleanSym(symbol);
        const params = new URLSearchParams({
          apiKey,
          apiSecret,
          testnet: String(testnet),
          isPerp: String(perp),
          symbol: sym,
          exchange,
        });
        try {
          const res = await fetch(`/api/trade/orders?${params}`);
          if (!res.ok) return;
          const data = await res.json();
          set({ orders: mapRawOrders(data, perp) });
        } catch {
          // silently fail
        }
      },

      fetchPositions: async (symbol) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret || !isPerp(symbol)) return;
        const sym = cleanSym(symbol);
        const params = new URLSearchParams({
          apiKey,
          apiSecret,
          testnet: String(testnet),
          symbol: sym,
          exchange,
        });
        try {
          const res = await fetch(`/api/trade/positions?${params}`);
          if (!res.ok) return;
          const data = await res.json();
          const positions = data as Position[];
          set({ positions });
          // Sync leverage from the first non-zero position so the panel
          // mirrors what the exchange has.
          const pos = positions.find((p) => p.positionAmt !== 0);
          if (pos && pos.leverage) {
            set((s) => ({ form: { ...s.form, leverage: pos.leverage } }));
          }
        } catch {
          // silently fail
        }
      },

      fetchAllPositions: async () => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return;
        // Omitting `symbol` makes both exchange routes return every open
        // position on the account instead of scoping to one.
        const params = new URLSearchParams({
          apiKey,
          apiSecret,
          testnet: String(testnet),
          exchange,
        });
        try {
          const res = await fetch(`/api/trade/positions?${params}`);
          if (!res.ok) return;
          const data = await res.json();
          set({ allPositions: data as Position[] });
        } catch {
          // silently fail
        }
      },

      syncPositionsFromAll: (symbol) => {
        if (!isPerp(symbol)) return;
        const sym = cleanSym(symbol);
        const positions = get().allPositions.filter((p) => p.symbol === sym);
        set({ positions });
        const pos = positions.find((p) => p.positionAmt !== 0);
        // Only write when the value actually changed. This runs on every poll
        // tick, and an unconditional `set` would hand out a fresh `form`
        // object each time — re-rendering the whole order panel every 2s and
        // stomping on the leverage field while the user is editing it.
        if (pos && pos.leverage && get().form.leverage !== pos.leverage) {
          set((s) => ({ form: { ...s.form, leverage: pos.leverage } }));
        }
      },

      syncAccount: async (symbol) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return;
        const perp = isPerp(symbol);
        const params = new URLSearchParams({
          apiKey,
          apiSecret,
          testnet: String(testnet),
          isPerp: String(perp),
          symbol: cleanSym(symbol),
          exchange,
        });
        try {
          const res = await fetch(`/api/trade/sync?${params}`);
          if (!res.ok) {
            set({ isConnected: false });
            return;
          }
          const data = (await res.json()) as {
            balance: SyncSlot<AssetBalance[]>;
            orders: SyncSlot<unknown>;
            positions: SyncSlot<Position[]>;
          };
          // Each slot is applied only if that read succeeded — a single failing
          // endpoint shouldn't blank the panels fed by the other two.
          if (data.balance?.data) set({ balance: data.balance.data, isConnected: true });
          if (data.orders?.data) set({ orders: mapRawOrders(data.orders.data, perp) });
          if (data.positions?.data) {
            set({ allPositions: data.positions.data });
            get().syncPositionsFromAll(symbol);
          }
        } catch {
          set({ isConnected: false });
        }
      },

      placeOrder: async (symbol, overrides) => {
        const { apiKey, apiSecret, testnet, exchange, form } = get();
        if (!apiKey || !apiSecret) return { ok: false, error: "No API credentials set." };

        // The chart may be on a different venue than the connected account.
        // Submitting anyway would fill on the wrong exchange's book, at a price
        // the user never saw. Same check the read-side overlays already make.
        const gate = tradeGate(symbol, exchange);
        if (!gate.ok) {
          set({ lastError: gate.reason });
          return { ok: false, error: gate.reason };
        }

        const f = { ...form, ...overrides };
        const perp = isPerp(symbol);
        const sym = cleanSym(symbol);

        set({ isLoading: true, lastError: null });

        // Bybit hedge mode: orders must carry a positionIdx (1 long / 2 short)
        // when the symbol is in hedge mode. The entry side decides it; its
        // attached reduceOnly SL/TP share the same index. This is checked
        // live rather than inferred from `positions`, since that list is
        // empty while flat — hedge mode would then go undetected and the
        // order would be submitted without a positionIdx, which Bybit
        // rejects when the account is actually in hedge mode.
        let posIdx: number | undefined;
        if (exchange === "bybit" && perp) {
          try {
            const params = new URLSearchParams({
              apiKey, apiSecret, testnet: String(testnet), exchange, symbol: sym,
            });
            const res = await fetch(`/api/trade/position-mode?${params}`);
            if (res.ok) {
              const { hedge } = await res.json() as { hedge: boolean };
              if (hedge) posIdx = f.side === "BUY" ? 1 : 2;
            }
          } catch {
            // fall back to no positionIdx (one-way default)
          }
        }

        // Bybit lets an order-create call attach takeProfit/stopLoss directly,
        // which Bybit then sets as the resulting POSITION's own TP/SL — the
        // same thing setting it by hand in Bybit's UI does. Binance's
        // order-create has no such field, so it still needs the separate
        // reduceOnly STOP_MARKET/TAKE_PROFIT_MARKET orders placed below.
        const nativeTpSl = exchange === "bybit" && perp && !f.reduceOnly;

        const body: PlaceOrderParams = {
          apiKey,
          apiSecret,
          testnet,
          exchange,
          symbol: sym,
          isPerp: perp,
          side: f.side,
          type: f.type,
          quantity: f.qty,
          ...(posIdx !== undefined ? { positionIdx: posIdx } : {}),
          ...(f.type !== "MARKET" && f.price ? { price: f.price } : {}),
          ...(["STOP", "STOP_LIMIT", "STOP_MARKET"].includes(f.type) && f.stopPrice
            ? { stopPrice: f.stopPrice }
            : {}),
          ...(f.type !== "MARKET" && f.type !== "STOP_MARKET"
            ? { timeInForce: f.timeInForce }
            : {}),
          ...(perp && f.reduceOnly ? { reduceOnly: true } : {}),
          ...(nativeTpSl && f.slEnabled && f.sl ? { stopLoss: f.sl } : {}),
          ...(nativeTpSl && f.tpEnabled && f.tp ? { takeProfit: f.tp } : {}),
        };

        try {
          const entry = await postOrder(body);
          if (!entry.ok) {
            const msg = entry.error ?? "Order failed";
            set({ isLoading: false, lastError: msg });
            return { ok: false, error: msg };
          }

          // The entry is filled/working from here on. A protective leg that
          // fails now leaves real exposure unprotected, so its outcome is
          // checked and surfaced rather than dropped — the exchange can reject
          // a stop the entry itself accepted (price moved, minNotional, a
          // trigger that would fire immediately).
          const exitSide: OrderSide = f.side === "BUY" ? "SELL" : "BUY";
          const failures: string[] = [];

          // Place SL as a separate reduceOnly order (perp only) — only when
          // it wasn't already attached natively above (Bybit).
          if (perp && !nativeTpSl && f.slEnabled && f.sl) {
            const r = await postOrder({
              apiKey, apiSecret, testnet, exchange,
              symbol: sym, isPerp: true,
              side: exitSide, type: "STOP_MARKET",
              quantity: f.qty, stopPrice: f.sl,
              reduceOnly: true, workingType: "MARK_PRICE",
              ...(posIdx !== undefined ? { positionIdx: posIdx } : {}),
            });
            if (!r.ok) failures.push(`stop-loss at ${f.sl} was rejected (${r.error})`);
          }

          // Place TP as a separate reduceOnly order (perp only) — only when
          // it wasn't already attached natively above (Bybit).
          if (perp && !nativeTpSl && f.tpEnabled && f.tp) {
            const r = await postOrder({
              apiKey, apiSecret, testnet, exchange,
              symbol: sym, isPerp: true,
              side: exitSide, type: "TAKE_PROFIT_MARKET",
              quantity: f.qty, stopPrice: f.tp,
              reduceOnly: true, workingType: "MARK_PRICE",
              ...(posIdx !== undefined ? { positionIdx: posIdx } : {}),
            });
            if (!r.ok) failures.push(`take-profit at ${f.tp} was rejected (${r.error})`);
          }

          set({ isLoading: false });
          void get().syncAccount(symbol);

          if (failures.length > 0) {
            // Deliberately loud: the entry went through, so the user now holds
            // an unprotected position and the panel's inline error alone is
            // easy to miss when the order ticket isn't on screen.
            const msg = `Entry filled, but the ${failures.join(" and ")}. The position is UNPROTECTED.`;
            set({ lastError: msg });
            useToastStore.getState().push({
              variant: "alert",
              title: "Protective order failed",
              message: msg,
              ttlMs: 0,
            });
            return { ok: false, error: msg };
          }

          return { ok: true };
        } catch (e) {
          set({ isLoading: false, lastError: String(e) });
          return { ok: false, error: String(e) };
        }
      },

      cancelOrder: async (symbol, orderId) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return;
        const perp = isPerp(symbol);
        const sym = cleanSym(symbol);
        try {
          const res = await fetch("/api/trade/order", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, apiSecret, testnet, exchange, symbol: sym, isPerp: perp, orderId }),
          });
          // Same reasoning as `postOrder`: a rejected cancel is a 400, not a
          // thrown error, and silently ignoring it leaves the user believing a
          // working order is gone when it is still live.
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { msg?: string };
            set({ lastError: data.msg ?? "cancel failed" });
          }
        } catch (e) {
          set({ lastError: String(e) });
        }
        void get().syncAccount(symbol);
      },

      modifyOrder: async (symbol, order, patch) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return { ok: false, error: "No credentials" };
        const perp = isPerp(symbol);
        const sym = cleanSym(symbol);

        // Re-post the quantity still working, not the original size. Anything
        // already filled has become position, and adding it back on top would
        // silently inflate exposure beyond what the user ever intended.
        const quantity = patch.quantity ?? remainingQty(order.origQty, order.executedQty);
        if (!(quantity > 0)) {
          // Nothing left to move. Bail out *before* cancelling: cancelling a
          // fully-filled order achieves nothing, but cancelling and then
          // failing to re-post would be a silent loss of protection.
          const msg = "Order is already filled — nothing left to modify.";
          set({ lastError: msg });
          void get().syncAccount(symbol);
          return { ok: false, error: msg };
        }

        // Bybit rejects a repost whose positionIdx doesn't match the account's
        // position mode. The order carries its own slot when the exchange
        // reported one; otherwise derive it, remembering that a reduceOnly
        // order belongs to the position on the *opposite* side.
        let posIdx = order.positionIdx;
        if (posIdx === undefined && exchange === "bybit" && perp) {
          try {
            const params = new URLSearchParams({
              apiKey, apiSecret, testnet: String(testnet), exchange, symbol: sym,
            });
            const res = await fetch(`/api/trade/position-mode?${params}`);
            if (res.ok) {
              const { hedge } = await res.json() as { hedge: boolean };
              if (hedge) posIdx = hedgePositionIdx(order.side, order.reduceOnly ?? false);
            }
          } catch {
            // fall back to no positionIdx (one-way default)
          }
        }

        set({ modifyingOrderId: order.orderId, lastError: null });

        // Cancel the original order first.
        try {
          const cancelRes = await fetch("/api/trade/order", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey, apiSecret, testnet, exchange,
              symbol: sym, isPerp: perp, orderId: order.orderId,
            }),
          });
          if (!cancelRes.ok) {
            const err = (await cancelRes.json().catch(() => ({}))) as { msg?: string };
            set({ modifyingOrderId: null, lastError: err.msg ?? "cancel failed" });
            return { ok: false, error: err.msg ?? "cancel failed" };
          }
        } catch (e) {
          set({ modifyingOrderId: null, lastError: String(e) });
          return { ok: false, error: String(e) };
        }

        // Re-post with the same params but the given overrides applied.
        // For trigger orders (STOP_MARKET / TAKE_PROFIT_MARKET) the relevant
        // price field is stopPrice; for LIMIT it's price.
        const isTrigger =
          order.type === "STOP_MARKET" || order.type === "TAKE_PROFIT_MARKET";
        const price = patch.price ?? (isTrigger ? order.stopPrice : order.price);
        const body: PlaceOrderParams = {
          apiKey, apiSecret, testnet, exchange,
          symbol: sym, isPerp: perp,
          side: order.side, type: order.type,
          quantity: String(quantity),
          ...(isTrigger ? { stopPrice: String(price) } : { price: String(price) }),
          ...(order.timeInForce && !isTrigger ? { timeInForce: order.timeInForce } : {}),
          ...(perp && order.reduceOnly ? { reduceOnly: true } : {}),
          ...(isTrigger ? { workingType: "MARK_PRICE" } : {}),
          ...(posIdx !== undefined ? { positionIdx: posIdx } : {}),
        };

        const replaced = await postOrder(body);
        set({ modifyingOrderId: null });
        if (!replaced.ok) {
          const msg = replaced.error ?? "replace failed";
          // The original order is already cancelled at this point, so the
          // cached list is stale the moment this fails. Refresh before the
          // next poll tick (up to 15s away at the idle rate), or the UI keeps
          // showing a working order — possibly a stop — that no longer exists.
          set({ lastError: msg });
          void get().syncAccount(symbol);
          if (order.reduceOnly) {
            useToastStore.getState().push({
              variant: "alert",
              title: "Protective order lost",
              message: `The ${order.type === "STOP_MARKET" ? "stop-loss" : "exit"} order was cancelled but could not be replaced: ${msg}`,
              ttlMs: 0,
            });
          }
          return { ok: false, error: msg };
        }
        void get().syncAccount(symbol);
        return { ok: true };
      },

      closePosition: async (symbol, position) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return { ok: false, error: "No credentials" };
        const perp = isPerp(symbol);
        const sym = cleanSym(symbol);
        const qty = Math.abs(position.positionAmt);
        if (qty <= 0) return { ok: false, error: "Position is empty" };
        const closeSide: OrderSide = position.positionAmt > 0 ? "SELL" : "BUY";
        try {
          const res = await fetch("/api/trade/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey, apiSecret, testnet, exchange,
              symbol: sym, isPerp: perp,
              side: closeSide, type: "MARKET",
              quantity: String(qty),
              ...(perp ? { reduceOnly: true } : {}),
              ...(position.positionIdx !== undefined ? { positionIdx: position.positionIdx } : {}),
            } satisfies PlaceOrderParams),
          });
          const data = (await res.json().catch(() => ({}))) as { msg?: string };
          if (!res.ok) {
            set({ lastError: data.msg ?? "close failed" });
            return { ok: false, error: data.msg ?? "close failed" };
          }
          void get().syncAccount(symbol);
          return { ok: true };
        } catch (e) {
          set({ lastError: String(e) });
          return { ok: false, error: String(e) };
        }
      },

      setPositionTpSl: async (symbol, position, { tp, sl }) => {
        const { apiKey, apiSecret, testnet, exchange, orders } = get();
        if (!apiKey || !apiSecret) return { ok: false, error: "No credentials" };
        const perp = isPerp(symbol);
        const sym = cleanSym(symbol);
        if (!perp) return { ok: false, error: "Position TP/SL only on perp" };
        const qty = Math.abs(position.positionAmt);
        const closeSide: OrderSide = position.positionAmt > 0 ? "SELL" : "BUY";

        // Bybit sets TP/SL directly on the position via /position/trading-stop.
        if (exchange === "bybit") {
          try {
            const res = await fetch("/api/trade/trading-stop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apiKey, apiSecret, testnet, symbol: sym, tp, sl,
                positionIdx: position.positionIdx,
              }),
            });
            const data = (await res.json().catch(() => ({}))) as { msg?: string };
            if (!res.ok) {
              set({ lastError: data.msg ?? "tp/sl failed" });
              return { ok: false, error: data.msg ?? "tp/sl failed" };
            }
            void get().syncAccount(symbol);
            return { ok: true };
          } catch (e) {
            set({ lastError: String(e) });
            return { ok: false, error: String(e) };
          }
        }

        // Cancel any existing reduceOnly TP / SL orders for this symbol on the
        // opposite side before placing new ones.
        async function cancelExisting(typeMatch: (t: string) => boolean) {
          const stale = orders.filter(
            (o) =>
              o.symbol === sym &&
              o.side === closeSide &&
              o.reduceOnly &&
              typeMatch(o.type),
          );
          for (const o of stale) {
            await fetch("/api/trade/order", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apiKey, apiSecret, testnet, exchange,
                symbol: sym, isPerp: true, orderId: o.orderId,
              }),
            });
          }
        }
        function place(type: "TAKE_PROFIT_MARKET" | "STOP_MARKET", stopPrice: number) {
          return postOrder({
            apiKey, apiSecret, testnet, exchange,
            symbol: sym, isPerp: true,
            side: closeSide, type,
            quantity: String(qty), stopPrice: String(stopPrice),
            reduceOnly: true, workingType: "MARK_PRICE",
          });
        }

        try {
          // The old protective order is cancelled before the new one goes in,
          // so a rejected replacement means the position is now bare — that
          // has to be reported, not swallowed behind `{ ok: true }`.
          const failures: string[] = [];
          if (tp !== undefined) {
            await cancelExisting((t) => t === "TAKE_PROFIT_MARKET" || t === "TAKE_PROFIT");
            if (tp !== null && tp > 0) {
              const r = await place("TAKE_PROFIT_MARKET", tp);
              if (!r.ok) failures.push(`take-profit at ${tp} was rejected (${r.error})`);
            }
          }
          if (sl !== undefined) {
            await cancelExisting((t) => t === "STOP_MARKET" || t === "STOP" || t === "STOP_LIMIT");
            if (sl !== null && sl > 0) {
              const r = await place("STOP_MARKET", sl);
              if (!r.ok) failures.push(`stop-loss at ${sl} was rejected (${r.error})`);
            }
          }
          void get().syncAccount(symbol);

          if (failures.length > 0) {
            const msg = `The ${failures.join(" and ")}. The position is UNPROTECTED.`;
            set({ lastError: msg });
            useToastStore.getState().push({
              variant: "alert",
              title: "Protective order failed",
              message: msg,
              ttlMs: 0,
            });
            return { ok: false, error: msg };
          }
          return { ok: true };
        } catch (e) {
          set({ lastError: String(e) });
          return { ok: false, error: String(e) };
        }
      },

      setLeverage: async (symbol, leverage) => {
        const { apiKey, apiSecret, testnet, exchange } = get();
        if (!apiKey || !apiSecret) return { ok: false, error: "No credentials" };
        const sym = cleanSym(symbol);
        // Optimistic update so the UI feels snappy.
        set((s) => ({ form: { ...s.form, leverage } }));
        try {
          const res = await fetch("/api/trade/leverage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, apiSecret, testnet, exchange, symbol: sym, leverage }),
          });
          const data = (await res.json().catch(() => ({}))) as { msg?: string };
          if (!res.ok) {
            set({ lastError: data.msg ?? "leverage failed" });
            return { ok: false, error: data.msg ?? "leverage failed" };
          }
          return { ok: true };
        } catch (e) {
          set({ lastError: String(e) });
          return { ok: false, error: String(e) };
        }
      },
    }),
    {
      name: "trading-store",
      version: 2,
      partialize: (s) => ({
        exchange: s.exchange,
        apiKey: s.apiKey,
        apiSecret: s.apiSecret,
        testnet: s.testnet,
        tradingPanelOpen: s.tradingPanelOpen,
        // Persist the input-unit preferences + leverage so they survive reloads.
        sizingMode: s.form.sizingMode,
        slMode: s.form.slMode,
        leverage: s.form.leverage,
      }),
      // v1 → v2: legacy persisted state had no sizingMode/leverage at the
      // top level. Just drop anything unknown and let defaults fill the gaps.
      migrate: ((persistedState: unknown) => {
        return (persistedState ?? {}) as ReturnType<typeof Object>;
      }) as never,
      onRehydrateStorage: () => (state) => {
        // partialize stores the input-unit modes + leverage at the top level;
        // reattach them to form on rehydrate.
        if (!state) return;
        const raw = state as unknown as Record<string, unknown>;
        const sm = raw.sizingMode as SizingMode | undefined;
        const slm = raw.slMode as SlMode | undefined;
        const lev = raw.leverage as number | undefined;
        if (sm || slm || lev !== undefined) {
          state.form = {
            ...state.form,
            ...(sm ? { sizingMode: sm } : {}),
            ...(slm ? { slMode: slm } : {}),
            ...(lev !== undefined ? { leverage: lev } : {}),
          };
        }
      },
    },
  ),
);
