import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  PAPER_STORAGE_KEY,
  usePaperTradingStore,
} from "./paper-trading-store";
import { DEFAULT_PAPER_SETTINGS, createAccount } from "@/lib/trading/paper-engine";
import { defaultPaperOrderForm, paperFormToMarketRequest } from "@/lib/trading/paper-order-form";

const st = () => usePaperTradingStore.getState();

beforeEach(() => {
  localStorage.removeItem(PAPER_STORAGE_KEY);
  st().resetAccount();
  usePaperTradingStore.setState({ marks: {} });
});

describe("paper-trading-store actions", () => {
  it("starts flat with the seeded balance", () => {
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
    expect(st().account.positions).toHaveLength(0);
  });

  it("placeOrder opens a position at the given quote price", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    expect(st().account.positions).toHaveLength(1);
    expect(st().account.balance).toBeCloseTo(7_990, 6);
    // The fill price seeds the mark, so equity is immediately meaningful.
    expect(st().marks.BTCUSDT).toBe(20_000);
    expect(st().equity()).toBeCloseTo(9_990, 6);
  });

  it("placeLimitOrder rests an order that evaluateTick fills on a cross", () => {
    st().placeLimitOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 1,
      price: 19_000,
      leverage: 10,
    });
    expect(st().account.orders).toHaveLength(1);

    st().evaluateTick("BTCUSDT", 19_500);
    expect(st().account.orders).toHaveLength(1);
    expect(st().account.positions).toHaveLength(0);

    st().evaluateTick("BTCUSDT", 19_000);
    expect(st().account.orders).toHaveLength(0);
    expect(st().account.positions).toHaveLength(1);
  });

  it("cancelOrder drops the order and refunds its reserve", () => {
    st().placeLimitOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 1,
      price: 19_000,
      leverage: 10,
    });
    st().cancelOrder(st().account.orders[0].id);
    expect(st().account.orders).toHaveLength(0);
    expect(st().account.balance).toBeCloseTo(DEFAULT_PAPER_SETTINGS.seedBalance, 6);
  });

  it("closePosition settles at the last known mark", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    st().evaluateTick("BTCUSDT", 21_000);
    st().closePosition("BTCUSDT");
    expect(st().account.positions).toHaveLength(0);
    expect(st().account.history).toHaveLength(1);
    expect(st().account.history[0].exitPrice).toBe(21_000);
    expect(st().account.balance).toBeGreaterThan(DEFAULT_PAPER_SETTINGS.seedBalance);
  });

  it("setBrackets attaches TP/SL that later ticks trigger", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    st().setBrackets("BTCUSDT", { tp: 21_000, sl: 19_500 });
    expect(st().account.positions[0].tp).toBe(21_000);

    st().evaluateTick("BTCUSDT", 21_200);
    expect(st().account.positions).toHaveLength(0);
    expect(st().account.history[0].reason).toBe("TP");
  });

  it("setBrackets drops a wrong-side stop using the symbol's last mark as reference (adversarial re-audit finding 2)", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    // The mark has since fallen to 19_500 (a live tick, still above the
    // 18_100 liquidation price so nothing else fires). A stop at 19_700 is
    // valid relative to the *entry* (20_000) but is already stale relative
    // to where price actually is now — passing the mark, not the entry,
    // as the reference is what catches that.
    st().evaluateTick("BTCUSDT", 19_500);
    st().setBrackets("BTCUSDT", { sl: 19_700 });
    expect(st().account.positions[0].sl).toBe(null);
  });

  it("evaluateTick leaves state untouched when nothing can fill", () => {
    const before = st().account;
    st().evaluateTick("BTCUSDT", 20_000);
    // No orders, no positions: not even the mark is worth storing.
    expect(st().account).toBe(before);
    expect(st().marks.BTCUSDT).toBe(undefined);
  });

  it("evaluateTick is idempotent at a repeated price", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    st().evaluateTick("BTCUSDT", 20_400);
    const account = st().account;
    const marks = st().marks;
    st().evaluateTick("BTCUSDT", 20_400);
    expect(st().account).toBe(account);
    expect(st().marks).toBe(marks);
  });

  it("resetAccount wipes back to the seed", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    st().evaluateTick("BTCUSDT", 21_000);
    st().closePosition("BTCUSDT");
    st().resetAccount();
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
    expect(st().account.history).toHaveLength(0);
    expect(st().marks).toEqual({});
  });

  it("placing an order built from a decorated symbol records the canonical key (adversarial review finding 3)", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1" };
    const req = paperFormToMarketRequest(form, "BYBIT:SOLUSDT.P");
    st().placeOrder(req, 100);
    expect(st().account.positions).toHaveLength(1);
    expect(st().account.positions[0].symbol).toBe("SOLUSDT");
    expect(st().marks.SOLUSDT).toBe(100);

    // A tick keyed by the same canonical symbol (as `usePaperExposureFeed`
    // now emits after cleaning) reaches the position it opened.
    st().evaluateTick("SOLUSDT", 110);
    expect(st().account.positions).toHaveLength(1);
    expect(st().marks.SOLUSDT).toBe(110);
  });

  it("updateSettings re-seeds the balance only while the account is untouched", () => {
    st().updateSettings({ seedBalance: 50_000 });
    expect(st().account.balance).toBe(50_000);

    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    const balance = st().account.balance;
    st().updateSettings({ seedBalance: 1_000 });
    expect(st().account.balance).toBe(balance);
    expect(st().account.settings.seedBalance).toBe(1_000);
  });
});

describe("paper-trading-store persistence", () => {
  it("writes the account to localStorage and rehydrates it", async () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    st().evaluateTick("BTCUSDT", 21_000);

    const raw = localStorage.getItem(PAPER_STORAGE_KEY);
    expect(typeof raw).toBe("string");
    const parsed = JSON.parse(raw as string) as {
      state: { account: { balance: number; positions: unknown[] }; marks?: unknown };
    };
    expect(parsed.state.account.positions).toHaveLength(1);
    expect(parsed.state.account.balance).toBeCloseTo(7_990, 6);
    // Live marks are session data, not account state.
    expect(parsed.state.marks).toBe(undefined);

    // Blow the in-memory state away, then restore it from storage. `setState`
    // is itself wrapped by `persist`, so wiping the store also rewrites the
    // blob — put the snapshot back first, the way a page reload would find it.
    usePaperTradingStore.setState({ account: createAccount(), marks: {} });
    expect(st().account.positions).toHaveLength(0);
    localStorage.setItem(PAPER_STORAGE_KEY, raw as string);

    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.positions).toHaveLength(1);
    expect(st().account.positions[0].entryPrice).toBe(20_000);
    expect(st().account.balance).toBeCloseTo(7_990, 6);
  });

  it("rehydrating a legacy blob without an account falls back to the seed", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({ state: {}, version: 1 }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
    expect(st().account.positions).toHaveLength(0);
  });

  it("rehydrating orders:null or a non-array history falls back to defaults instead of corrupting the account (adversarial review finding 8)", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: { account: { positions: [], orders: null, history: [], balance: 1_000 } },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
    expect(st().account.positions).toHaveLength(0);
    // Previously `usedMargin` (via `equity`) would crash reducing over `orders: null`.
    expect(typeof st().equity()).toBe("number");

    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: {
          account: { positions: [], orders: [], history: "not-an-array", balance: 1_000 },
        },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);

    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: { account: { positions: [], orders: [], history: [], balance: "1000" } },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
  });
});

describe("persist merge validation (adversarial re-audit finding 4)", () => {
  it("rejects a NaN balance instead of accepting it (typeof NaN === 'number', so a naive check passes it)", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: { account: { positions: [], orders: [], history: [], balance: Number.NaN } },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
    // The rejected blob's account never applies, so a normal order still works.
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    expect(st().account.positions).toHaveLength(1);
    expect(Number.isFinite(st().account.balance)).toBe(true);
  });

  it("drops a null entry inside a persisted positions array instead of letting it crash equity()", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: { account: { positions: [null], orders: [], history: [], balance: 1_000 } },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.positions).toHaveLength(0);
    expect(typeof st().equity()).toBe("number");
  });

  it("drops a position whose numeric fields are missing or non-finite", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: {
          account: {
            positions: [
              { id: "p1", symbol: "BTCUSDT", qty: Number.NaN, entryPrice: 20_000, margin: 2_000 },
              { id: "p2", symbol: "ETHUSDT", qty: 1, entryPrice: 1_000, margin: 100 },
            ],
            orders: [],
            history: [],
            balance: 1_000,
          },
        },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.positions).toHaveLength(1);
    expect(st().account.positions[0].symbol).toBe("ETHUSDT");
  });

  it("drops an order whose price or qty is missing or non-finite", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: {
          account: {
            positions: [],
            orders: [
              { id: "o1", symbol: "BTCUSDT", price: "abc", qty: 1 },
              { id: "o2", symbol: "ETHUSDT", price: 1_000, qty: 1 },
            ],
            history: [],
            balance: 1_000,
          },
        },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.orders).toHaveLength(1);
    expect(st().account.orders[0].symbol).toBe("ETHUSDT");
  });

  it("ignores a non-finite persisted settings value instead of rehydrating a NaN fee rate", async () => {
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        state: {
          account: {
            positions: [],
            orders: [],
            history: [],
            balance: 10_000,
            settings: { takerFeeRate: "abc" },
          },
        },
        version: 1,
      }),
    );
    await usePaperTradingStore.persist.rehydrate();
    expect(st().account.settings.takerFeeRate).toBe(DEFAULT_PAPER_SETTINGS.takerFeeRate);
    // A normal fill's fee is a real number, not NaN.
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    expect(Number.isFinite(st().account.balance)).toBe(true);
  });
});

describe("persist write skipping (adversarial review finding 7)", () => {
  it("does not re-write localStorage on a tick that only moves the mark", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    const rawAfterOpen = localStorage.getItem(PAPER_STORAGE_KEY);

    // No bracket set, so this tick fills and triggers nothing: only `marks`
    // changes, and the persisted `account` slice is unchanged.
    st().evaluateTick("BTCUSDT", 20_400);
    expect(st().marks.BTCUSDT).toBe(20_400);
    expect(localStorage.getItem(PAPER_STORAGE_KEY)).toBe(rawAfterOpen);

    // A real account mutation still persists.
    st().closePosition("BTCUSDT");
    expect(localStorage.getItem(PAPER_STORAGE_KEY) === rawAfterOpen).toBe(false);
  });
});
