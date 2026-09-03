import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  MAX_PAPER_EVENTS,
  PAPER_STORAGE_KEY,
  usePaperTradingStore,
} from "./paper-trading-store";
import { createAccount } from "@/lib/trading/paper-engine";

const store = () => usePaperTradingStore.getState();

beforeEach(() => {
  usePaperTradingStore.setState({ account: createAccount(), marks: {}, events: [] });
});

describe("paper-trading-store actions", () => {
  it("seeds a virtual balance on first use", () => {
    expect(store().account.balance).toBe(10_000);
    expect(store().account.positions).toHaveLength(0);
  });

  it("places a market order at the given price", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    expect(store().account.positions).toHaveLength(1);
    expect(store().account.balance).toBeCloseTo(7_990, 6);
    expect(store().events.map((e) => e.type)).toEqual(["fill"]);
  });

  it("falls back to the last seen mark when no price is passed", () => {
    store().evaluateTick("BTCUSDT", 20_000);
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 });
    expect(store().account.positions[0].entryPrice).toBe(20_000);
  });

  it("does nothing when a market order has no price and no mark", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 });
    expect(store().account.positions).toHaveLength(0);
  });

  it("rests and cancels a limit order, returning the reserve", () => {
    store().placeLimitOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 1,
      leverage: 10,
      price: 19_000,
    });
    expect(store().account.orders).toHaveLength(1);
    expect(store().account.balance).toBeCloseTo(8_096.2, 6);
    store().cancelOrder(store().account.orders[0].id);
    expect(store().account.orders).toHaveLength(0);
    expect(store().account.balance).toBeCloseTo(10_000, 6);
  });

  it("fills a resting limit order off a tick and records the mark", () => {
    store().placeLimitOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 1,
      leverage: 10,
      price: 19_000,
    });
    store().evaluateTick("BTCUSDT", 19_500);
    expect(store().account.positions).toHaveLength(0);
    store().evaluateTick("BTCUSDT", 18_900);
    expect(store().account.positions).toHaveLength(1);
    expect(store().marks.BTCUSDT).toBe(18_900);
  });

  it("closes a position at the current mark", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    store().evaluateTick("BTCUSDT", 21_000);
    store().closePosition("BTCUSDT");
    expect(store().account.positions).toHaveLength(0);
    expect(store().account.history).toHaveLength(1);
    expect(store().account.balance).toBeCloseTo(10_979.5, 6);
  });

  it("drives brackets from the tick, stopping out before taking profit", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    store().setBrackets("BTCUSDT", 20_500, 21_000);
    store().evaluateTick("BTCUSDT", 20_700);
    expect(store().account.history).toHaveLength(1);
    expect(store().account.history[0].reason).toBe("SL");
  });

  it("skips the engine entirely when a tick has nothing to act on", () => {
    const before = store().account;
    store().evaluateTick("ETHUSDT", 3_000);
    // No position and no resting order for the symbol: the account object is
    // untouched, so subscribers never re-render off an idle WS tick.
    expect(store().account).toBe(before);
    expect(store().marks.ETHUSDT).toBe(undefined);
  });

  it("keeps the account object stable across repeated identical ticks", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    store().evaluateTick("BTCUSDT", 20_100);
    const after = store().account;
    store().evaluateTick("BTCUSDT", 20_100);
    expect(store().account).toBe(after);
  });

  it("resets back to the seed", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    store().closePosition("BTCUSDT", 21_000);
    store().resetAccount();
    expect(store().account.balance).toBe(10_000);
    expect(store().account.history).toHaveLength(0);
    expect(store().account.positions).toHaveLength(0);
    expect(store().events).toHaveLength(0);
  });

  it("reseeds the balance when the seed setting changes on a flat account", () => {
    store().updateSettings({ seedBalance: 50_000 });
    store().resetAccount();
    expect(store().account.balance).toBe(50_000);
  });

  it("bounds the event log so a long session cannot grow it without limit", () => {
    for (let i = 0; i < MAX_PAPER_EVENTS + 30; i++) {
      store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 0.001, leverage: 10 }, 20_000);
    }
    expect(store().events).toHaveLength(MAX_PAPER_EVENTS);
  });
});

describe("paper-trading-store persistence", () => {
  it("round-trips the account through localStorage", async () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    store().placeLimitOrder({
      symbol: "BTCUSDT",
      side: "SELL",
      qty: 1,
      leverage: 10,
      price: 25_000,
    });
    const balance = store().account.balance;

    const raw = localStorage.getItem(PAPER_STORAGE_KEY);
    expect(typeof raw).toBe("string");
    const parsed = JSON.parse(raw as string) as { state: { account: { balance: number } } };
    expect(parsed.state.account.balance).toBeCloseTo(balance, 6);

    // Wipe the in-memory state (which also rewrites storage), restore the
    // snapshot, then rehydrate the way a page reload would.
    usePaperTradingStore.setState({ account: createAccount(), marks: {}, events: [] });
    expect(store().account.balance).toBe(10_000);
    localStorage.setItem(PAPER_STORAGE_KEY, raw as string);
    await usePaperTradingStore.persist.rehydrate();

    expect(store().account.balance).toBeCloseTo(balance, 6);
    expect(store().account.positions).toHaveLength(1);
    expect(store().account.positions[0].entryPrice).toBe(20_000);
    expect(store().account.orders).toHaveLength(1);
    expect(store().account.orders[0].price).toBe(25_000);
  });

  it("does not persist session-only marks and events", () => {
    store().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    store().evaluateTick("BTCUSDT", 20_500);
    const parsed = JSON.parse(localStorage.getItem(PAPER_STORAGE_KEY) as string) as {
      state: Record<string, unknown>;
    };
    expect(Object.keys(parsed.state)).toEqual(["account"]);
  });
});
