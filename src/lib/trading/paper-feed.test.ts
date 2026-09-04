import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { paperFeedExposure, paperFeedSource } from "./paper-feed";
import { createAccount, evaluateTick, fillMarketOrder, placeLimitOrder } from "./paper-engine";
import type { PaperAccount } from "./paper-engine";

const NOW = 1_700_000_000_000;

describe("paperFeedSource", () => {
  it("uses Binance for a plain ticker", () => {
    expect(paperFeedSource("BTCUSDT")).toBe("binance");
    expect(paperFeedSource("BTCUSDT.P")).toBe("binance");
  });

  it("uses Bybit for a BYBIT:-prefixed ticker", () => {
    expect(paperFeedSource("BYBIT:SOLUSDT.P")).toBe("bybit");
  });

  it("has no feed for a synthetic expression", () => {
    expect(paperFeedSource("BTCUSDT-ETHUSDT")).toBe(null);
  });

  it("has no feed for a catalog stock (Yahoo-sourced)", () => {
    expect(paperFeedSource("AAPL")).toBe(null);
  });
});

describe("paperFeedExposure", () => {
  function acct(): PaperAccount {
    return createAccount();
  }

  it("is empty for a flat account", () => {
    const exposure = paperFeedExposure(acct());
    expect(exposure.binance).toHaveLength(0);
    expect(exposure.bybit).toHaveLength(0);
  });

  it("groups an open position's feedSymbol by venue", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, feedSymbol: "BTCUSDT.P" },
      20_000,
      NOW,
    ).account;
    const exposure = paperFeedExposure(a);
    expect(exposure.binance).toEqual(["BTCUSDT.P"]);
    expect(exposure.bybit).toHaveLength(0);
  });

  it("routes a BYBIT:-prefixed feedSymbol to bybit", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "SOLUSDT", side: "BUY", qty: 1, leverage: 10, feedSymbol: "BYBIT:SOLUSDT.P" },
      100,
      NOW,
    ).account;
    const exposure = paperFeedExposure(a);
    expect(exposure.bybit).toEqual(["BYBIT:SOLUSDT.P"]);
    expect(exposure.binance).toHaveLength(0);
  });

  it("includes a resting order's feedSymbol", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "ETHUSDT", side: "BUY", qty: 1, price: 1_000, leverage: 10, feedSymbol: "ETHUSDT" },
      NOW,
    ).account;
    expect(paperFeedExposure(a).binance).toEqual(["ETHUSDT"]);
  });

  it("excludes a cancelled order's feedSymbol", () => {
    let a = placeLimitOrder(
      acct(),
      { symbol: "ETHUSDT", side: "BUY", qty: 1, price: 1_000, leverage: 10, feedSymbol: "ETHUSDT" },
      NOW,
    ).account;
    a = { ...a, orders: a.orders.map((o) => ({ ...o, status: "CANCELED" as const })) };
    expect(paperFeedExposure(a).binance).toHaveLength(0);
  });

  it("skips a position/order with no feedSymbol", () => {
    const a = fillMarketOrder(acct(), { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000, NOW)
      .account;
    const exposure = paperFeedExposure(a);
    expect(exposure.binance).toHaveLength(0);
    expect(exposure.bybit).toHaveLength(0);
  });

  it("de-duplicates a symbol shared by a position and a resting order", () => {
    let a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, feedSymbol: "BTCUSDT.P" },
      20_000,
      NOW,
    ).account;
    a = placeLimitOrder(
      a,
      { symbol: "ETHUSDT", side: "BUY", qty: 1, price: 1_000, leverage: 10, feedSymbol: "BTCUSDT.P" },
      NOW,
    ).account;
    expect(paperFeedExposure(a).binance).toEqual(["BTCUSDT.P"]);
  });

  it("prefers a position's venue over a resting order's for the same bare symbol", () => {
    let a = fillMarketOrder(
      acct(),
      { symbol: "SOLUSDT", side: "BUY", qty: 1, leverage: 10, feedSymbol: "BYBIT:SOLUSDT.P" },
      100,
      NOW,
    ).account;
    a = placeLimitOrder(
      a,
      { symbol: "SOLUSDT", side: "BUY", qty: 1, price: 90, leverage: 10, feedSymbol: "SOLUSDT.P" },
      NOW,
    ).account;
    const exposure = paperFeedExposure(a);
    expect(exposure.bybit).toEqual(["BYBIT:SOLUSDT.P"]);
    expect(exposure.binance).toHaveLength(0);
  });

  it("keeps a symbol's exposure once its last order fills into a position", () => {
    let a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, feedSymbol: "BTCUSDT.P" },
      20_000,
      NOW,
    ).account;
    a = placeLimitOrder(
      a,
      { symbol: "ETHUSDT", side: "BUY", qty: 1, price: 1_000, leverage: 10, feedSymbol: "ETHUSDT" },
      NOW,
    ).account;

    const before = paperFeedExposure(a);
    expect(before.binance).toEqual(["BTCUSDT.P", "ETHUSDT"]);

    // A tick at or below the resting limit's price crosses it: the order
    // fills into a fresh ETHUSDT position and is dropped from `orders`.
    a = evaluateTick(a, "ETHUSDT", 999, NOW + 1).account;
    expect(a.orders).toHaveLength(0);
    expect(a.positions).toHaveLength(2);

    const after = paperFeedExposure(a);
    expect(after.binance).toEqual(["BTCUSDT.P", "ETHUSDT"]);
  });

  it("swaps a symbol's exposure to the flip's own feedSymbol on a long-to-short flip", () => {
    let a = fillMarketOrder(
      acct(),
      { symbol: "SOLUSDT", side: "BUY", qty: 1, leverage: 10, feedSymbol: "SOLUSDT.P" },
      100,
      NOW,
    ).account;
    const before = paperFeedExposure(a);
    expect(before.binance).toEqual(["SOLUSDT.P"]);
    expect(before.bybit).toHaveLength(0);

    // A larger opposite-side fill closes the long and opens a fresh short —
    // the new position carries this fill's own feedSymbol, not the closed
    // position's.
    a = fillMarketOrder(
      a,
      { symbol: "SOLUSDT", side: "SELL", qty: 2, leverage: 10, feedSymbol: "BYBIT:SOLUSDT.P" },
      100,
      NOW + 1,
    ).account;
    const position = a.positions.find((p) => p.symbol === "SOLUSDT");
    expect(position?.side).toBe("SHORT");

    const after = paperFeedExposure(a);
    expect(after.binance).toHaveLength(0);
    expect(after.bybit).toEqual(["BYBIT:SOLUSDT.P"]);
  });
});
