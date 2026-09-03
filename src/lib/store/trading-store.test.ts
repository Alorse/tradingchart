import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { useTradingStore } from "./trading-store";
import { useToastStore } from "@/lib/alerts/toast-store";
import type { Order } from "@/lib/binance/trading-types";

/**
 * Order-execution paths with a stubbed `fetch`. These cover the failure modes
 * that cost money rather than the happy path alone: a protective leg the
 * exchange rejects, and a cancel/replace that must not resurrect filled size
 * or lose its hedge slot.
 */

interface RecordedCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

interface StubReply {
  ok?: boolean;
  status?: number;
  json?: unknown;
}

let calls: RecordedCall[] = [];
/** Queue of replies for POST/DELETE /api/trade/order, consumed in order. */
let orderReplies: StubReply[] = [];
/** Reply for GET /api/trade/position-mode. */
let hedgeReply = false;

const realFetch = globalThis.fetch;

function reply(r: StubReply): Response {
  const ok = r.ok ?? true;
  return {
    ok,
    status: r.status ?? (ok ? 200 : 400),
    json: async () => r.json ?? {},
  } as Response;
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, method, body });

    if (url.startsWith("/api/trade/order")) {
      return reply(orderReplies.shift() ?? { ok: true, json: { orderId: 1 } });
    }
    if (url.startsWith("/api/trade/position-mode")) {
      return reply({ ok: true, json: { hedge: hedgeReply } });
    }
    if (url.startsWith("/api/trade/sync")) {
      return reply({
        ok: true,
        json: {
          balance: { data: [], error: null },
          orders: { data: [], error: null },
          positions: { data: [], error: null },
        },
      });
    }
    return reply({ ok: true, json: {} });
  }) as typeof globalThis.fetch;
}

/** Requests that actually reached the order endpoint. */
function orderCalls(): RecordedCall[] {
  return calls.filter((c) => c.url.startsWith("/api/trade/order"));
}

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    orderId: 42,
    clientOrderId: "x",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    status: "NEW",
    price: 100,
    origQty: 1,
    executedQty: 0,
    timeInForce: "GTC",
    time: 0,
    updateTime: 0,
    reduceOnly: false,
    isPerp: true,
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  orderReplies = [];
  hedgeReply = false;
  installFetch();
  useToastStore.setState({ toasts: [] });
  useTradingStore.setState({
    apiKey: "k",
    apiSecret: "s",
    testnet: true,
    exchange: "binance",
    lastError: null,
    orders: [],
    positions: [],
    allPositions: [],
  });
  useTradingStore.getState().resetForm();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("placeOrder — venue gating", () => {
  it("refuses to submit a Bybit chart symbol to a Binance account", async () => {
    useTradingStore.setState({ exchange: "binance" });
    useTradingStore.getState().updateForm({ qty: "1", type: "MARKET" });

    const res = await useTradingStore.getState().placeOrder("BYBIT:SOLUSDT.P");

    expect(res.ok).toBe(false);
    // The decisive assertion: nothing was sent to the wrong exchange.
    expect(orderCalls()).toHaveLength(0);
  });

  it("submits when the chart and the account are the same venue", async () => {
    useTradingStore.getState().updateForm({ qty: "1", type: "MARKET" });

    const res = await useTradingStore.getState().placeOrder("BTCUSDT.P");

    expect(res.ok).toBe(true);
    expect(orderCalls()).toHaveLength(1);
  });
});

describe("placeOrder — protective legs", () => {
  it("reports failure when the stop-loss leg is rejected after the entry fills", async () => {
    useTradingStore.getState().updateForm({
      qty: "1", type: "MARKET", slEnabled: true, sl: "90",
    });
    orderReplies = [
      { ok: true, json: { orderId: 1 } },                       // entry fills
      { ok: false, json: { msg: "Order would immediately trigger." } }, // SL rejected
    ];

    const res = await useTradingStore.getState().placeOrder("BTCUSDT.P");

    expect(res.ok).toBe(false);
    expect(res.error).toContain("stop-loss");
    expect(res.error).toContain("UNPROTECTED");
    // The entry is NOT rolled back — it filled. It has to be reported instead.
    expect(orderCalls()).toHaveLength(2);
    expect(useTradingStore.getState().lastError).toContain("UNPROTECTED");
  });

  it("raises a persistent toast when a protective leg fails", async () => {
    useTradingStore.getState().updateForm({
      qty: "1", type: "MARKET", slEnabled: true, sl: "90",
    });
    orderReplies = [{ ok: true, json: {} }, { ok: false, json: { msg: "rejected" } }];

    await useTradingStore.getState().placeOrder("BTCUSDT.P");

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("alert");
    // ttl 0 = doesn't auto-dismiss; an unprotected position shouldn't vanish
    // from the screen after six seconds.
    expect(toasts[0].expiresAt).toBe(0);
  });

  it("reports both legs when the take-profit is rejected too", async () => {
    useTradingStore.getState().updateForm({
      qty: "1", type: "MARKET", slEnabled: true, sl: "90", tpEnabled: true, tp: "120",
    });
    orderReplies = [
      { ok: true, json: {} },
      { ok: false, json: { msg: "bad stop" } },
      { ok: false, json: { msg: "bad target" } },
    ];

    const res = await useTradingStore.getState().placeOrder("BTCUSDT.P");

    expect(res.ok).toBe(false);
    expect(res.error).toContain("stop-loss");
    expect(res.error).toContain("take-profit");
  });

  it("succeeds quietly when every leg is accepted", async () => {
    useTradingStore.getState().updateForm({
      qty: "1", type: "MARKET", slEnabled: true, sl: "90", tpEnabled: true, tp: "120",
    });

    const res = await useTradingStore.getState().placeOrder("BTCUSDT.P");

    expect(res.ok).toBe(true);
    expect(orderCalls()).toHaveLength(3);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("stops at the entry when the entry itself is rejected", async () => {
    useTradingStore.getState().updateForm({
      qty: "1", type: "MARKET", slEnabled: true, sl: "90",
    });
    orderReplies = [{ ok: false, json: { msg: "Insufficient balance" } }];

    const res = await useTradingStore.getState().placeOrder("BTCUSDT.P");

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Insufficient balance");
    // No protective leg for a position that was never opened.
    expect(orderCalls()).toHaveLength(1);
  });
});

describe("modifyOrder — cancel/replace", () => {
  it("re-posts only the unfilled remainder of a partially-filled order", async () => {
    const order = makeOrder({ origQty: 1, executedQty: 0.4 });

    await useTradingStore.getState().modifyOrder("BTCUSDT.P", order, { price: 105 });

    const posted = orderCalls().find((c) => c.method === "POST");
    expect(posted?.body.quantity).toBe("0.6");
  });

  it("keeps an explicit quantity override untouched", async () => {
    const order = makeOrder({ origQty: 1, executedQty: 0.4 });

    await useTradingStore.getState().modifyOrder("BTCUSDT.P", order, { quantity: 2 });

    const posted = orderCalls().find((c) => c.method === "POST");
    expect(posted?.body.quantity).toBe("2");
  });

  it("refuses to cancel an already-filled order", async () => {
    const order = makeOrder({ origQty: 1, executedQty: 1 });

    const res = await useTradingStore.getState().modifyOrder("BTCUSDT.P", order, { price: 105 });

    expect(res.ok).toBe(false);
    // Nothing was cancelled: the order is gone, and a cancel here could only
    // be followed by a repost that re-opens filled size.
    expect(orderCalls()).toHaveLength(0);
  });

  it("carries the order's own positionIdx into the repost", async () => {
    useTradingStore.setState({ exchange: "bybit" });
    const order = makeOrder({ positionIdx: 2, side: "SELL" });

    await useTradingStore.getState().modifyOrder("BYBIT:BTCUSDT.P", order, { price: 105 });

    const posted = orderCalls().find((c) => c.method === "POST");
    expect(posted?.body.positionIdx).toBe(2);
  });

  it("derives the hedge slot from the position a reduceOnly order closes", async () => {
    useTradingStore.setState({ exchange: "bybit" });
    hedgeReply = true;
    // A reduceOnly SELL is the LONG's stop → slot 1, not 2.
    const order = makeOrder({ side: "SELL", reduceOnly: true, type: "STOP_MARKET", stopPrice: 90 });

    await useTradingStore.getState().modifyOrder("BYBIT:BTCUSDT.P", order, { price: 95 });

    const posted = orderCalls().find((c) => c.method === "POST");
    expect(posted?.body.positionIdx).toBe(1);
  });

  it("sends no positionIdx on a one-way account", async () => {
    useTradingStore.setState({ exchange: "bybit" });
    hedgeReply = false;
    const order = makeOrder({ side: "SELL", reduceOnly: true });

    await useTradingStore.getState().modifyOrder("BYBIT:BTCUSDT.P", order, { price: 95 });

    const posted = orderCalls().find((c) => c.method === "POST");
    expect("positionIdx" in (posted?.body ?? {})).toBe(false);
  });

  it("refreshes the account when the repost fails, so the cancelled order stops showing", async () => {
    const order = makeOrder();
    orderReplies = [
      { ok: true, json: {} },                        // cancel succeeds
      { ok: false, json: { msg: "price out of range" } }, // repost rejected
    ];

    const res = await useTradingStore.getState().modifyOrder("BTCUSDT.P", order, { price: 105 });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("price out of range");
    expect(calls.some((c) => c.url.startsWith("/api/trade/sync"))).toBe(true);
  });

  it("warns loudly when the order it failed to replace was a protective one", async () => {
    const order = makeOrder({ reduceOnly: true, type: "STOP_MARKET", stopPrice: 90 });
    orderReplies = [{ ok: true, json: {} }, { ok: false, json: { msg: "rejected" } }];

    await useTradingStore.getState().modifyOrder("BTCUSDT.P", order, { price: 95 });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toContain("Protective order lost");
  });

  it("does not re-post when the cancel is rejected", async () => {
    const order = makeOrder();
    orderReplies = [{ ok: false, json: { msg: "unknown order" } }];

    const res = await useTradingStore.getState().modifyOrder("BTCUSDT.P", order, { price: 105 });

    expect(res.ok).toBe(false);
    expect(orderCalls().filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("cancelOrder", () => {
  it("surfaces a rejected cancel instead of assuming it worked", async () => {
    orderReplies = [{ ok: false, json: { msg: "Unknown order sent." } }];

    await useTradingStore.getState().cancelOrder("BTCUSDT.P", 42);

    expect(useTradingStore.getState().lastError).toBe("Unknown order sent.");
  });
});
