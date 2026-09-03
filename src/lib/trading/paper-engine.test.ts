import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  DEFAULT_PAPER_SETTINGS,
  cancelOrder,
  closePosition,
  createAccount,
  equity,
  evaluateTick,
  fillMarketOrder,
  liquidationPrice,
  placeLimitOrder,
  positionRoi,
  resetAccount,
  setBrackets,
  unrealizedPnl,
  usedMargin,
  type PaperAccount,
} from "./paper-engine";

/**
 * The paper engine is pure: every entry point takes an account and returns a
 * new one, so the numbers below are exact and can be asserted to the cent.
 *
 * The fixture is deliberately round — 10,000 USDT seed, 20,000 entry, 10x,
 * 0.05% taker / 0.02% maker — so margin (2,000), fees (10 / 4) and P&L can be
 * checked by hand against the balance rather than against the engine's own
 * arithmetic restated in the test.
 */

const T0 = 1_700_000_000_000;

function acct(): PaperAccount {
  return createAccount();
}

/** Open 1 BTC long at 20,000 with 10x. margin 2,000, taker fee 10. */
function longAt20k(a = acct()): PaperAccount {
  return fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000, T0)
    .account;
}

describe("paper-engine seed + settings", () => {
  it("seeds a fresh account with the default virtual balance and no state", () => {
    const a = acct();
    expect(a.balance).toBe(DEFAULT_PAPER_SETTINGS.seedBalance);
    expect(a.balance).toBe(10_000);
    expect(a.positions).toHaveLength(0);
    expect(a.orders).toHaveLength(0);
    expect(a.history).toHaveLength(0);
  });

  it("accepts overridden settings and seeds from them", () => {
    const a = createAccount({ seedBalance: 50_000, takerFeeRate: 0 });
    expect(a.balance).toBe(50_000);
    expect(a.settings.takerFeeRate).toBe(0);
    // Untouched keys keep their defaults.
    expect(a.settings.makerFeeRate).toBe(DEFAULT_PAPER_SETTINGS.makerFeeRate);
  });
});

describe("market fills", () => {
  it("opens a long, locking margin and charging the taker fee", () => {
    const { account: a, events } = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 },
      20_000,
      T0,
    );
    expect(a.positions).toHaveLength(1);
    const p = a.positions[0];
    expect(p.side).toBe("LONG");
    expect(p.qty).toBe(1);
    expect(p.entryPrice).toBe(20_000);
    expect(p.margin).toBeCloseTo(2_000, 6);
    expect(p.feesPaid).toBeCloseTo(10, 6);
    // 10,000 − 2,000 margin − 10 fee
    expect(a.balance).toBeCloseTo(7_990, 6);
    expect(events.map((e) => e.type)).toEqual(["fill"]);
  });

  it("opens a short the same way", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      20_000,
      T0,
    ).account;
    expect(a.positions[0].side).toBe("SHORT");
    expect(a.balance).toBeCloseTo(7_990, 6);
  });

  it("rejects an order the free balance cannot margin", () => {
    // 100 BTC at 20,000 on 10x needs 200,000 of margin.
    const { account: a, events } = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 100, leverage: 10 },
      20_000,
      T0,
    );
    expect(a.positions).toHaveLength(0);
    expect(a.balance).toBe(10_000);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("reject");
  });

  it("clamps leverage into the 1x-125x range", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 0.01, leverage: 500 },
      20_000,
      T0,
    ).account;
    expect(a.positions[0].leverage).toBe(125);
    const b = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 0.01, leverage: 0 },
      20_000,
      T0,
    ).account;
    expect(b.positions[0].leverage).toBe(1);
  });

  it("averages into a same-side position rather than opening a second one", () => {
    let a = longAt20k();
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 22_000, T0)
      .account;
    expect(a.positions).toHaveLength(1);
    expect(a.positions[0].qty).toBeCloseTo(2, 6);
    expect(a.positions[0].entryPrice).toBeCloseTo(21_000, 6);
    // 2,000 + 2,200 margin, 10 + 11 fees
    expect(a.positions[0].margin).toBeCloseTo(4_200, 6);
    expect(a.balance).toBeCloseTo(10_000 - 4_200 - 21, 6);
  });

  it("nets an opposite-side market order against the open position", () => {
    let a = longAt20k();
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "SELL", qty: 0.4, leverage: 10 }, 21_000, T0)
      .account;
    expect(a.positions).toHaveLength(1);
    expect(a.positions[0].side).toBe("LONG");
    expect(a.positions[0].qty).toBeCloseTo(0.6, 6);
    expect(a.history).toHaveLength(1);
    expect(a.history[0].qty).toBeCloseTo(0.4, 6);
  });

  it("flips the position when the opposite order is larger than it", () => {
    let a = longAt20k();
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "SELL", qty: 1.5, leverage: 10 }, 21_000, T0)
      .account;
    expect(a.positions).toHaveLength(1);
    expect(a.positions[0].side).toBe("SHORT");
    expect(a.positions[0].qty).toBeCloseTo(0.5, 6);
    expect(a.positions[0].entryPrice).toBe(21_000);
    expect(a.history).toHaveLength(1);
  });
});

describe("P&L after a price move", () => {
  it("reports unrealized P&L and ROI on a long", () => {
    const a = longAt20k();
    expect(unrealizedPnl(a.positions[0], 21_000)).toBeCloseTo(1_000, 6);
    // ROI is against the position's own margin, not the notional.
    expect(positionRoi(a.positions[0], 21_000)).toBeCloseTo(0.5, 6);
  });

  it("reports unrealized P&L on a short with the opposite sign", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      20_000,
      T0,
    ).account;
    expect(unrealizedPnl(a.positions[0], 19_000)).toBeCloseTo(1_000, 6);
    expect(unrealizedPnl(a.positions[0], 21_000)).toBeCloseTo(-1_000, 6);
  });

  it("realizes P&L net of both legs' fees when closing a winner", () => {
    const a = longAt20k();
    const { account: b, events } = closePosition(a, "BTCUSDT", 21_000, T0 + 60_000);
    expect(b.positions).toHaveLength(0);
    // margin 2,000 + gross 1,000 − exit fee 10.5, on top of the 7,990 left.
    expect(b.balance).toBeCloseTo(10_979.5, 6);
    const trade = b.history[0];
    expect(trade.grossPnl).toBeCloseTo(1_000, 6);
    // entry fee 10 + exit fee 10.5
    expect(trade.fees).toBeCloseTo(20.5, 6);
    expect(trade.realizedPnl).toBeCloseTo(979.5, 6);
    expect(trade.roi).toBeCloseTo(979.5 / 2_000, 6);
    expect(trade.durationMs).toBe(60_000);
    expect(trade.reason).toBe("MANUAL");
    expect(events.map((e) => e.type)).toEqual(["close"]);
  });

  it("a flat round trip loses exactly the two fees", () => {
    const a = longAt20k();
    const b = closePosition(a, "BTCUSDT", 20_000, T0 + 1).account;
    expect(b.balance).toBeCloseTo(10_000 - 20, 6);
    expect(b.history[0].realizedPnl).toBeCloseTo(-20, 6);
  });

  it("closes only part of a position when a qty is given", () => {
    const a = longAt20k();
    const b = closePosition(a, "BTCUSDT", 21_000, T0 + 1, 0.25).account;
    expect(b.positions[0].qty).toBeCloseTo(0.75, 6);
    // A quarter of the margin and of the entry fee travels with the close.
    expect(b.positions[0].margin).toBeCloseTo(1_500, 6);
    expect(b.positions[0].feesPaid).toBeCloseTo(7.5, 6);
    expect(b.history[0].grossPnl).toBeCloseTo(250, 6);
    expect(b.history[0].fees).toBeCloseTo(2.5 + 0.25 * 21_000 * 0.0005, 6);
  });
});

describe("limit orders", () => {
  it("rests a buy limit, reserving margin plus the maker fee", () => {
    const { account: a } = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0,
    );
    expect(a.orders).toHaveLength(1);
    expect(a.orders[0].status).toBe("NEW");
    // margin 1,900 + maker fee 3.8
    expect(a.orders[0].reserved).toBeCloseTo(1_903.8, 6);
    expect(a.balance).toBeCloseTo(8_096.2, 6);
    expect(a.positions).toHaveLength(0);
  });

  it("does not fill a buy limit while price stays above it", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0,
    ).account;
    const { account: b, events } = evaluateTick(a, "BTCUSDT", 19_500, T0 + 1);
    expect(b.positions).toHaveLength(0);
    expect(b.orders[0].status).toBe("NEW");
    expect(events).toHaveLength(0);
  });

  it("fills a buy limit when the tick crosses down to it", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0,
    ).account;
    const { account: b, events } = evaluateTick(a, "BTCUSDT", 19_000, T0 + 1);
    expect(b.positions).toHaveLength(1);
    expect(b.positions[0].side).toBe("LONG");
    // Fills at the limit price, not at the tick.
    expect(b.positions[0].entryPrice).toBe(19_000);
    expect(b.orders[0].status).toBe("FILLED");
    // Reserve released, then margin 1,900 + maker fee 3.8 charged.
    expect(b.balance).toBeCloseTo(8_096.2, 6);
    expect(events.map((e) => e.type)).toEqual(["fill"]);
  });

  it("does not fill a sell limit while price stays below it", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10, price: 21_000 },
      T0,
    ).account;
    const b = evaluateTick(a, "BTCUSDT", 20_500, T0 + 1).account;
    expect(b.positions).toHaveLength(0);
    expect(b.orders[0].status).toBe("NEW");
  });

  it("fills a sell limit when the tick crosses up to it", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10, price: 21_000 },
      T0,
    ).account;
    const b = evaluateTick(a, "BTCUSDT", 21_500, T0 + 1).account;
    expect(b.positions).toHaveLength(1);
    expect(b.positions[0].side).toBe("SHORT");
    expect(b.positions[0].entryPrice).toBe(21_000);
  });

  it("carries the order's brackets onto the position it opens", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000, tp: 20_000, sl: 18_500 },
      T0,
    ).account;
    const b = evaluateTick(a, "BTCUSDT", 19_000, T0 + 1).account;
    expect(b.positions[0].tp).toBe(20_000);
    expect(b.positions[0].sl).toBe(18_500);
  });

  it("ignores ticks for other symbols", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0,
    ).account;
    const { account: b } = evaluateTick(a, "ETHUSDT", 1, T0 + 1);
    expect(b).toBe(a);
  });

  it("cancelling a resting order returns its reserve", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0,
    ).account;
    const b = cancelOrder(a, a.orders[0].id, T0 + 1).account;
    expect(b.balance).toBeCloseTo(10_000, 6);
    expect(b.orders).toHaveLength(0);
  });

  it("cancelling an unknown order is a no-op on the same account object", () => {
    const a = acct();
    expect(cancelOrder(a, "nope", T0).account).toBe(a);
  });

  it("rejects a limit order the free balance cannot reserve", () => {
    const { account: a, events } = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 100, leverage: 10, price: 19_000 },
      T0,
    );
    expect(a.orders).toHaveLength(0);
    expect(a.balance).toBe(10_000);
    expect(events[0].type).toBe("reject");
  });
});

describe("TP / SL brackets", () => {
  it("closes a long at its take-profit when the tick reaches it", () => {
    const a = setBrackets(longAt20k(), "BTCUSDT", 21_000, 19_000);
    const { account: b, events } = evaluateTick(a, "BTCUSDT", 21_050, T0 + 1);
    expect(b.positions).toHaveLength(0);
    expect(b.history).toHaveLength(1);
    expect(b.history[0].reason).toBe("TP");
    // Fills at the bracket's price, not at the overshooting tick.
    expect(b.history[0].exitPrice).toBe(21_000);
    expect(events.map((e) => e.type)).toEqual(["close"]);
  });

  it("closes a long at its stop-loss when the tick reaches it", () => {
    const a = setBrackets(longAt20k(), "BTCUSDT", 21_000, 19_000);
    const b = evaluateTick(a, "BTCUSDT", 18_900, T0 + 1).account;
    expect(b.history[0].reason).toBe("SL");
    expect(b.history[0].exitPrice).toBe(19_000);
    expect(b.history[0].grossPnl).toBeCloseTo(-1_000, 6);
  });

  it("mirrors the trigger directions on a short", () => {
    const short = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10, tp: 19_000, sl: 21_000 },
      20_000,
      T0,
    ).account;
    expect(evaluateTick(short, "BTCUSDT", 18_500, T0 + 1).account.history[0].reason).toBe("TP");
    expect(evaluateTick(short, "BTCUSDT", 21_500, T0 + 1).account.history[0].reason).toBe("SL");
  });

  it("gives the stop-loss precedence when both brackets cross on one tick", () => {
    // A single price can only satisfy both a long's TP (price >= tp) and its
    // SL (price <= sl) when the stop has been trailed above the target — the
    // degenerate case the precedence rule exists for.
    const a = setBrackets(longAt20k(), "BTCUSDT", 20_500, 21_000);
    const { account: b, events } = evaluateTick(a, "BTCUSDT", 20_700, T0 + 1);
    expect(b.history).toHaveLength(1);
    expect(b.history[0].reason).toBe("SL");
    expect(b.history[0].exitPrice).toBe(21_000);
    // At most one trigger per position per tick.
    expect(events).toHaveLength(1);
    expect(b.positions).toHaveLength(0);
  });

  it("triggers at most once — a second tick past the bracket does nothing", () => {
    const a = setBrackets(longAt20k(), "BTCUSDT", 21_000, 19_000);
    const b = evaluateTick(a, "BTCUSDT", 21_050, T0 + 1).account;
    const { account: c, events } = evaluateTick(b, "BTCUSDT", 21_100, T0 + 2);
    expect(c).toBe(b);
    expect(events).toHaveLength(0);
    expect(c.history).toHaveLength(1);
  });

  it("setBrackets clears a bracket when passed null", () => {
    const a = setBrackets(longAt20k(), "BTCUSDT", 21_000, 19_000);
    const b = setBrackets(a, "BTCUSDT", null, 19_000);
    expect(b.positions[0].tp).toBeNull();
    expect(evaluateTick(b, "BTCUSDT", 25_000, T0 + 1).account.positions).toHaveLength(1);
  });
});

describe("leverage, margin and liquidation", () => {
  it("prices the isolated-margin liquidation level off leverage and MMR", () => {
    // 20,000 * (1 − 1/10 + 0.005)
    expect(liquidationPrice("LONG", 20_000, 10, 0.005)).toBeCloseTo(18_100, 6);
    expect(liquidationPrice("SHORT", 20_000, 10, 0.005)).toBeCloseTo(21_900, 6);
    // Higher leverage sits the level closer to entry.
    expect(liquidationPrice("LONG", 20_000, 50, 0.005)).toBeCloseTo(19_700, 6);
  });

  it("stamps the liquidation price on the opened position", () => {
    const a = longAt20k();
    expect(a.positions[0].liquidationPrice).toBeCloseTo(18_100, 6);
  });

  it("halves the margin when leverage doubles", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 20 },
      20_000,
      T0,
    ).account;
    expect(a.positions[0].margin).toBeCloseTo(1_000, 6);
    expect(a.balance).toBeCloseTo(10_000 - 1_000 - 10, 6);
    expect(usedMargin(a)).toBeCloseTo(1_000, 6);
  });

  it("liquidates the position, forfeiting its margin", () => {
    const a = longAt20k();
    const { account: b, events } = evaluateTick(a, "BTCUSDT", 18_000, T0 + 1);
    expect(b.positions).toHaveLength(0);
    expect(b.history[0].reason).toBe("LIQUIDATION");
    expect(b.history[0].exitPrice).toBeCloseTo(18_100, 6);
    expect(events).toHaveLength(1);
    // Balance is what was left after opening; the whole margin is gone bar the
    // maintenance sliver the liquidation level preserves.
    expect(b.balance).toBeLessThan(8_100);
    expect(b.balance).toBeGreaterThan(7_990);
  });

  it("tracks equity as free balance + margin + unrealized P&L", () => {
    const a = longAt20k();
    // 7,990 free + 2,000 margin + 1,000 unrealized
    expect(equity(a, { BTCUSDT: 21_000 })).toBeCloseTo(10_990, 6);
    // With no mark for the symbol, the position is valued at its entry.
    expect(equity(a, {})).toBeCloseTo(9_990, 6);
  });

  it("counts a resting order's reserve as used margin", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0,
    ).account;
    expect(usedMargin(a)).toBeCloseTo(1_903.8, 6);
    expect(equity(a, {})).toBeCloseTo(10_000, 6);
  });
});

describe("evaluateTick cheapness", () => {
  it("returns the same account object when there is nothing to do", () => {
    const a = acct();
    expect(evaluateTick(a, "BTCUSDT", 20_000, T0).account).toBe(a);
  });

  it("is idempotent for a repeated price with an open, untriggered position", () => {
    const a = setBrackets(longAt20k(), "BTCUSDT", 30_000, 10_000);
    const b = evaluateTick(a, "BTCUSDT", 20_100, T0 + 1).account;
    expect(b).toBe(a);
    expect(evaluateTick(b, "BTCUSDT", 20_100, T0 + 2).account).toBe(a);
  });

  it("rejects non-finite or non-positive ticks without touching the account", () => {
    const a = setBrackets(longAt20k(), "BTCUSDT", 21_000, 19_000);
    expect(evaluateTick(a, "BTCUSDT", 0, T0 + 1).account).toBe(a);
    expect(evaluateTick(a, "BTCUSDT", NaN, T0 + 1).account).toBe(a);
  });
});

describe("reset", () => {
  it("restores the seed while keeping the configured settings", () => {
    let a = createAccount({ seedBalance: 25_000 });
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 }, 20_000, T0)
      .account;
    a = closePosition(a, "BTCUSDT", 21_000, T0 + 1).account;
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, price: 19_000 },
      T0 + 2,
    ).account;
    expect(a.history).toHaveLength(1);

    const r = resetAccount(a);
    expect(r.balance).toBe(25_000);
    expect(r.positions).toHaveLength(0);
    expect(r.orders).toHaveLength(0);
    expect(r.history).toHaveLength(0);
    expect(r.settings).toEqual(a.settings);
  });
});
