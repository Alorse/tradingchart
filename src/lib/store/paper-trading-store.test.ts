import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  PAPER_STORAGE_KEY,
  clearPersistedPaperAccount,
  sanitizePaperAccount,
  usePaperTradingStore,
} from "./paper-trading-store";
import { DEFAULT_PAPER_SETTINGS, createAccount } from "@/lib/trading/paper-engine";
import { defaultPaperOrderForm, paperFormToMarketRequest } from "@/lib/trading/paper-order-form";

const st = () => usePaperTradingStore.getState();

/** Fully-formed persisted shapes — every field the sanitizer checks, so a
 *  test can spread one and corrupt exactly the field it's about. */
const VALID_POSITION = {
  id: "p", symbol: "ETHUSDT", side: "LONG", qty: 1, entryPrice: 1_000,
  leverage: 10, margin: 100, feesPaid: 0.5, tp: null, sl: null,
  liquidationPrice: 900, feedSymbol: null, openedAt: 0,
};
const VALID_ORDER = {
  id: "o", symbol: "ETHUSDT", side: "BUY", type: "LIMIT", price: 1_000, qty: 1,
  leverage: 10, status: "NEW", tp: null, sl: null, reserved: 100,
  feedSymbol: null, createdAt: 0, updatedAt: 0,
};
const VALID_TRADE = {
  id: "t", symbol: "ETHUSDT", side: "LONG", qty: 1, entryPrice: 1_000, exitPrice: 1_100,
  leverage: 10, margin: 100, fees: 1, grossPnl: 100, realizedPnl: 99, roi: 0.99,
  reason: "MANUAL", openedAt: 0, closedAt: 1, durationMs: 1,
};

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

  it("reversePosition flips the position at the last known mark", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    st().evaluateTick("BTCUSDT", 21_000);
    st().reversePosition("BTCUSDT");
    expect(st().account.positions).toHaveLength(1);
    expect(st().account.positions[0].side).toBe("SHORT");
    expect(st().account.positions[0].entryPrice).toBe(21_000);
    expect(st().account.history).toHaveLength(1);
  });

  it("reversePosition is a no-op with no mark and no explicit price", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    usePaperTradingStore.setState({ marks: {} });
    const before = st().account;
    st().reversePosition("BTCUSDT");
    expect(st().account).toBe(before);
  });

  it("setPnlDisplayMode updates the persisted preference", () => {
    expect(st().pnlDisplayMode).toBe("MONEY");
    st().setPnlDisplayMode("PERCENT");
    expect(st().pnlDisplayMode).toBe("PERCENT");
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
    // Venue prefix stripped, `.P` kept — see holistic review finding 4.
    expect(st().account.positions[0].symbol).toBe("SOLUSDT.P");
    expect(st().marks["SOLUSDT.P"]).toBe(100);

    // A tick keyed by the same canonical symbol (as `usePaperExposureFeed`
    // emits after stripping the venue prefix) reaches the position it opened.
    st().evaluateTick("SOLUSDT.P", 110);
    expect(st().account.positions).toHaveLength(1);
    expect(st().marks["SOLUSDT.P"]).toBe(110);
  });

  it("keeps a spot position and a perp position on the same ticker separate (holistic review finding 4)", () => {
    // Sized to fit the seed balance: the spot leg is forced to 1x, so its
    // margin is the full notional.
    const form = { ...defaultPaperOrderForm(10), qty: "0.1" };
    // Spot long, then a perp sell of the same size: two instruments, so the
    // sell must open a second (short) position rather than close the first.
    st().placeOrder(paperFormToMarketRequest(form, "BTCUSDT"), 20_000);
    st().placeOrder(
      paperFormToMarketRequest({ ...form, side: "SELL" }, "BTCUSDT.P"),
      20_000,
    );

    expect(st().account.positions).toHaveLength(2);
    expect(st().account.positions.map((p) => p.symbol)).toEqual(["BTCUSDT", "BTCUSDT.P"]);
    expect(st().account.positions.map((p) => p.side)).toEqual(["LONG", "SHORT"]);
    expect(st().account.history).toHaveLength(0);

    // And their marks stay independent: a perp tick can't reprice the spot leg.
    st().evaluateTick("BTCUSDT.P", 21_000);
    expect(st().marks["BTCUSDT.P"]).toBe(21_000);
    expect(st().marks.BTCUSDT).toBe(20_000);
  });

  it("still nets one instrument charted from two venues (BYBIT: prefix only)", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1" };
    st().placeOrder(paperFormToMarketRequest(form, "SOLUSDT.P"), 100);
    st().placeOrder(paperFormToMarketRequest({ ...form, side: "SELL" }, "BYBIT:SOLUSDT.P"), 100);

    expect(st().account.positions).toHaveLength(0);
    expect(st().account.history).toHaveLength(1);
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

  it("persists pnlDisplayMode across a rehydrate, ignoring an unknown value", async () => {
    st().setPnlDisplayMode("TICKS");
    const raw = localStorage.getItem(PAPER_STORAGE_KEY);
    usePaperTradingStore.setState({ pnlDisplayMode: "MONEY" });
    localStorage.setItem(PAPER_STORAGE_KEY, raw as string);
    await usePaperTradingStore.persist.rehydrate();
    expect(st().pnlDisplayMode).toBe("TICKS");

    // An unrecognized value falls back to whatever the store currently holds
    // instead of rendering an unmapped unit.
    const corrupted = JSON.parse(raw as string) as { state: Record<string, unknown> };
    corrupted.state.pnlDisplayMode = "BOGUS";
    localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(corrupted));
    usePaperTradingStore.setState({ pnlDisplayMode: "PERCENT" });
    await usePaperTradingStore.persist.rehydrate();
    expect(st().pnlDisplayMode).toBe("PERCENT");
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
              { ...VALID_POSITION, id: "p1", symbol: "BTCUSDT", qty: Number.NaN },
              { ...VALID_POSITION, id: "p2", symbol: "ETHUSDT" },
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
              { ...VALID_ORDER, id: "o1", symbol: "BTCUSDT", price: "abc" },
              { ...VALID_ORDER, id: "o2", symbol: "ETHUSDT" },
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

describe("sanitizePaperAccount (shared by localStorage merge and cloud sync)", () => {
  it("rejects a non-object and a shape missing the required arrays/balance", () => {
    expect(sanitizePaperAccount(null)).toBe(null);
    expect(sanitizePaperAccount(undefined)).toBe(null);
    expect(sanitizePaperAccount("not-an-object")).toBe(null);
    expect(sanitizePaperAccount({})).toBe(null);
    expect(sanitizePaperAccount({ positions: [], orders: [], history: [] })).toBe(null);
    expect(
      sanitizePaperAccount({ positions: [], orders: [], history: [], balance: Number.NaN }),
    ).toBe(null);
  });

  it("accepts a well-formed account and drops invalid array entries/settings", () => {
    const account = sanitizePaperAccount({
      positions: [{ ...VALID_POSITION, symbol: "BTCUSDT" }, null],
      orders: [{ ...VALID_ORDER, price: "abc" }],
      history: [VALID_TRADE],
      balance: 5_000,
      settings: { takerFeeRate: "abc", makerFeeRate: 0.001 },
    });
    expect(account === null).toBe(false);
    expect(account?.balance).toBe(5_000);
    expect(account?.positions).toHaveLength(1);
    expect(account?.orders).toHaveLength(0);
    expect(account?.history).toHaveLength(1);
    expect(account?.settings.takerFeeRate).toBe(DEFAULT_PAPER_SETTINGS.takerFeeRate);
    expect(account?.settings.makerFeeRate).toBe(0.001);
  });
});

describe("sanitizePaperAccount rejection classes (holistic review finding 3)", () => {
  function sanitized(patch: Record<string, unknown>) {
    return sanitizePaperAccount({
      positions: [], orders: [], history: [], balance: 1_000, ...patch,
    });
  }

  it("rejects the whole blob for a NaN or negative balance", () => {
    expect(sanitized({ balance: Number.NaN })).toBe(null);
    expect(sanitized({ balance: -1 })).toBe(null);
    // Fully deployed but solvent is legitimate.
    expect(sanitized({ balance: 0 })?.balance).toBe(0);
  });

  it("drops a null position and one with a non-positive qty", () => {
    expect(sanitized({ positions: [null] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, qty: 0 }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, qty: -1 }] })?.positions).toHaveLength(0);
  });

  it("drops a position with a negative margin or a non-finite entry/leverage/fee", () => {
    expect(sanitized({ positions: [{ ...VALID_POSITION, margin: -1 }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, entryPrice: "1000" }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, leverage: Number.NaN }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, feesPaid: null }] })?.positions).toHaveLength(0);
  });

  it("drops a position whose side is outside the direction enum", () => {
    expect(sanitized({ positions: [{ ...VALID_POSITION, side: "BUY" }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, side: undefined }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, side: "SHORT" }] })?.positions).toHaveLength(1);
  });

  it("drops a position whose bracket is neither a finite price nor null", () => {
    expect(sanitized({ positions: [{ ...VALID_POSITION, tp: "1200" }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, sl: undefined }] })?.positions).toHaveLength(0);
    expect(sanitized({ positions: [{ ...VALID_POSITION, tp: 1_200, sl: 900 }] })?.positions).toHaveLength(1);
  });

  it("drops an order whose reserve survived as a string, which would concatenate into usedMargin", () => {
    expect(sanitized({ orders: [{ ...VALID_ORDER, reserved: "100" }] })?.orders).toHaveLength(0);
    expect(sanitized({ orders: [{ ...VALID_ORDER, reserved: Number.NaN }] })?.orders).toHaveLength(0);
  });

  it("drops an order with a non-positive qty, non-finite price, or an unknown side/status", () => {
    expect(sanitized({ orders: [{ ...VALID_ORDER, qty: 0 }] })?.orders).toHaveLength(0);
    expect(sanitized({ orders: [{ ...VALID_ORDER, price: Number.NaN }] })?.orders).toHaveLength(0);
    expect(sanitized({ orders: [{ ...VALID_ORDER, side: "LONG" }] })?.orders).toHaveLength(0);
    expect(sanitized({ orders: [{ ...VALID_ORDER, status: "PARTIALLY_FILLED" }] })?.orders).toHaveLength(0);
    expect(sanitized({ orders: [{ ...VALID_ORDER, status: "CANCELED" }] })?.orders).toHaveLength(1);
  });

  it("drops an empty trade object and one with a non-finite rendered field", () => {
    expect(sanitized({ history: [{}] })?.history).toHaveLength(0);
    expect(sanitized({ history: [null] })?.history).toHaveLength(0);
    for (const field of ["realizedPnl", "fees", "roi", "qty", "entryPrice", "exitPrice"]) {
      expect(sanitized({ history: [{ ...VALID_TRADE, [field]: Number.NaN }] })?.history).toHaveLength(0);
    }
    expect(sanitized({ history: [VALID_TRADE] })?.history).toHaveLength(1);
  });

  it("keeps equity finite after rehydrating a blob full of rejected entries", () => {
    const account = sanitized({
      positions: [{ ...VALID_POSITION, margin: "100" }],
      orders: [{ ...VALID_ORDER, reserved: "100" }],
      history: [{}],
    });
    expect(account === null).toBe(false);
    usePaperTradingStore.getState().setAccount(account!);
    expect(Number.isFinite(usePaperTradingStore.getState().equity())).toBe(true);
  });
});

describe("setAccount (cloud-adoption path)", () => {
  it("replaces the account wholesale without touching marks", () => {
    usePaperTradingStore.setState({ marks: { BTCUSDT: 123 } });
    const incoming = { ...createAccount(), balance: 42_000 };
    st().setAccount(incoming);
    expect(st().account.balance).toBe(42_000);
    expect(st().marks.BTCUSDT).toBe(123);
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

  it("clearPersistedPaperAccount drops the blob and the write-skip cache with it", () => {
    st().placeOrder({ symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000);
    expect(localStorage.getItem(PAPER_STORAGE_KEY) === null).toBe(false);

    clearPersistedPaperAccount();
    expect(localStorage.getItem(PAPER_STORAGE_KEY)).toBeNull();

    // A `set` that leaves the persisted slice reference-identical (only
    // `marks` moves) must still re-write now that the blob is gone — with the
    // cache left stale by a hand-rolled `localStorage.removeItem`, this write
    // short-circuits and storage stays empty for the rest of the session.
    usePaperTradingStore.setState({ marks: { BTCUSDT: 20_400 } });
    expect(localStorage.getItem(PAPER_STORAGE_KEY) === null).toBe(false);
  });
});
