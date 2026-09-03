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
  unrealizedPnl,
  usedMargin,
} from "./paper-engine";
import type { PaperAccount } from "./paper-engine";

/**
 * The paper fills engine is pure: every function takes an account and returns a
 * new one plus the events it produced. These tests pin the money math (margin,
 * fees, realized/unrealized P&L), the fill rules (market at quote, limit on
 * cross) and the per-tick trigger semantics (SL before TP, one trigger per
 * position per tick).
 *
 * Fixture used throughout: 10,000 USDT seed, 0.05% taker / 0.02% maker, 10x.
 */

const NOW = 1_700_000_000_000;
const S = DEFAULT_PAPER_SETTINGS;

function acct(): PaperAccount {
  return createAccount();
}

/** Open 1 BTC at `price` and return the resulting account. */
function openLong(a: PaperAccount, price = 20_000, qty = 1, leverage = 10) {
  return fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty, leverage }, price, NOW)
    .account;
}

function pos(a: PaperAccount, symbol = "BTCUSDT") {
  const p = a.positions.find((x) => x.symbol === symbol);
  if (!p) throw new Error(`no position for ${symbol}`);
  return p;
}

describe("createAccount / resetAccount", () => {
  it("seeds the virtual balance and starts empty", () => {
    const a = acct();
    expect(a.balance).toBe(S.seedBalance);
    expect(a.positions).toHaveLength(0);
    expect(a.orders).toHaveLength(0);
    expect(a.history).toHaveLength(0);
  });

  it("accepts settings overrides", () => {
    const a = createAccount({ seedBalance: 500, takerFeeRate: 0.001 });
    expect(a.balance).toBe(500);
    expect(a.settings.takerFeeRate).toBe(0.001);
    // untouched keys keep their defaults
    expect(a.settings.makerFeeRate).toBe(S.makerFeeRate);
  });

  it("reset restores the seed state but keeps settings", () => {
    let a = createAccount({ seedBalance: 1_000 });
    a = openLong(a, 20_000, 0.1);
    a = placeLimitOrder(
      a,
      { symbol: "ETHUSDT", side: "BUY", qty: 1, price: 1_000, leverage: 10 },
      NOW,
    ).account;
    a = closePosition(a, "BTCUSDT", 21_000, NOW + 1_000).account;
    expect(a.history).toHaveLength(1);

    const r = resetAccount(a);
    expect(r.balance).toBe(1_000);
    expect(r.positions).toHaveLength(0);
    expect(r.orders).toHaveLength(0);
    expect(r.history).toHaveLength(0);
    expect(r.settings.seedBalance).toBe(1_000);
  });
});

describe("market orders", () => {
  it("fills a long at the quote and locks margin + taker fee", () => {
    const a = openLong(acct(), 20_000, 1, 10);
    const p = pos(a);
    expect(p.side).toBe("LONG");
    expect(p.qty).toBe(1);
    expect(p.entryPrice).toBe(20_000);
    expect(p.margin).toBeCloseTo(2_000, 6);
    expect(p.feesPaid).toBeCloseTo(10, 6); // 20_000 * 0.0005
    // 10_000 - 2_000 margin - 10 fee
    expect(a.balance).toBeCloseTo(7_990, 6);
    expect(usedMargin(a)).toBeCloseTo(2_000, 6);
  });

  it("fills a short at the quote", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      20_000,
      NOW,
    ).account;
    const p = pos(a);
    expect(p.side).toBe("SHORT");
    expect(p.entryPrice).toBe(20_000);
    expect(a.balance).toBeCloseTo(7_990, 6);
  });

  it("emits a fill event and records the order as FILLED", () => {
    const res = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10 },
      20_000,
      NOW,
    );
    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe("fill");
    // A market order never rests: it is not left in the working-orders list.
    expect(res.account.orders).toHaveLength(0);
  });

  it("rejects an order the free balance cannot margin", () => {
    const res = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 100, leverage: 10 },
      20_000,
      NOW,
    );
    expect(res.events[0].type).toBe("reject");
    expect(res.account.positions).toHaveLength(0);
    expect(res.account.balance).toBe(S.seedBalance);
  });

  it("averages into an existing same-side position", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = openLong(a, 22_000, 1, 10);
    const p = pos(a);
    expect(p.qty).toBeCloseTo(2, 8);
    expect(p.entryPrice).toBeCloseTo(21_000, 6);
    expect(p.margin).toBeCloseTo(4_200, 6); // 2_000 + 2_200
  });

  it("nets an opposite-side market order against the open position", () => {
    let a = openLong(acct(), 20_000, 2, 10);
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      21_000,
      NOW + 1,
    ).account;
    const p = pos(a);
    expect(p.side).toBe("LONG");
    expect(p.qty).toBeCloseTo(1, 8);
    expect(a.history).toHaveLength(1);
    expect(a.history[0].qty).toBeCloseTo(1, 8);
  });

  it("flips the position when the opposite order is larger", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 3, leverage: 10 },
      21_000,
      NOW + 1,
    ).account;
    const p = pos(a);
    expect(p.side).toBe("SHORT");
    expect(p.qty).toBeCloseTo(2, 8);
    expect(p.entryPrice).toBe(21_000);
    expect(a.history).toHaveLength(1);
  });
});

describe("P&L", () => {
  it("unrealized P&L and ROI follow the mark, signed by direction", () => {
    const long = pos(openLong(acct(), 20_000, 1, 10));
    expect(unrealizedPnl(long, 21_000)).toBeCloseTo(1_000, 6);
    expect(unrealizedPnl(long, 19_000)).toBeCloseTo(-1_000, 6);
    // ROI is P&L over the initial margin, not a price-delta estimate.
    expect(positionRoi(long, 21_000)).toBeCloseTo(0.5, 6);

    const short = pos(
      fillMarketOrder(
        acct(),
        { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
        20_000,
        NOW,
      ).account,
    );
    expect(unrealizedPnl(short, 19_000)).toBeCloseTo(1_000, 6);
    expect(unrealizedPnl(short, 21_000)).toBeCloseTo(-1_000, 6);
  });

  it("closing returns margin + gross P&L - exit fee, and books the net trade", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = closePosition(a, "BTCUSDT", 21_000, NOW + 60_000).account;

    // 7_990 + 2_000 margin + 1_000 gross - 10.5 exit fee
    expect(a.balance).toBeCloseTo(10_979.5, 6);
    expect(a.positions).toHaveLength(0);

    const t = a.history[0];
    expect(t.grossPnl).toBeCloseTo(1_000, 6);
    expect(t.fees).toBeCloseTo(20.5, 6); // 10 entry + 10.5 exit
    expect(t.realizedPnl).toBeCloseTo(979.5, 6);
    expect(t.roi).toBeCloseTo(979.5 / 2_000, 8);
    expect(t.durationMs).toBe(60_000);
    expect(t.reason).toBe("MANUAL");
    // Balance moved by exactly the net realized P&L.
    expect(a.balance - S.seedBalance).toBeCloseTo(t.realizedPnl, 6);
  });

  it("a flat round trip loses exactly both fees", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = closePosition(a, "BTCUSDT", 20_000, NOW + 1).account;
    expect(a.balance).toBeCloseTo(9_980, 6); // 10 + 10
    expect(a.history[0].realizedPnl).toBeCloseTo(-20, 6);
  });

  it("a short profits when price falls", () => {
    let a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      20_000,
      NOW,
    ).account;
    a = closePosition(a, "BTCUSDT", 19_000, NOW + 1).account;
    expect(a.history[0].grossPnl).toBeCloseTo(1_000, 6);
    expect(a.balance).toBeGreaterThan(S.seedBalance);
  });

  it("a partial close books only the closed slice and keeps the rest", () => {
    let a = openLong(acct(), 20_000, 2, 10);
    a = closePosition(a, "BTCUSDT", 21_000, NOW + 1, 1).account;
    const p = pos(a);
    expect(p.qty).toBeCloseTo(1, 8);
    expect(p.margin).toBeCloseTo(2_000, 6); // half of 4_000 released
    expect(a.history[0].qty).toBeCloseTo(1, 8);
    expect(a.history[0].grossPnl).toBeCloseTo(1_000, 6);
  });

  it("equity is free balance + locked margin + unrealized P&L", () => {
    const a = openLong(acct(), 20_000, 1, 10);
    expect(equity(a, { BTCUSDT: 20_000 })).toBeCloseTo(9_990, 6); // seed - entry fee
    expect(equity(a, { BTCUSDT: 21_000 })).toBeCloseTo(10_990, 6);
    // A symbol with no mark falls back to the entry price.
    expect(equity(a, {})).toBeCloseTo(9_990, 6);
  });
});

describe("leverage and margin", () => {
  it("margin scales inversely with leverage", () => {
    // 10_000 seed cannot margin a 20_000 notional at 1x, but can at 25x.
    expect(openLong(acct(), 20_000, 1, 1).positions).toHaveLength(0);

    const a10 = openLong(acct(), 20_000, 1, 10);
    expect(pos(a10).margin).toBeCloseTo(2_000, 6);

    const a25 = openLong(acct(), 20_000, 1, 25);
    expect(pos(a25).margin).toBeCloseTo(800, 6);
    expect(a25.balance).toBeCloseTo(10_000 - 800 - 10, 6);
  });

  it("clamps leverage into the 1x-125x range", () => {
    const hi = openLong(acct(), 20_000, 0.1, 1_000);
    expect(pos(hi).leverage).toBe(125);
    const lo = openLong(acct(), 20_000, 0.1, 0);
    expect(pos(lo).leverage).toBe(1);
  });

  it("derives the isolated-margin liquidation price from leverage", () => {
    // 20_000 * (1 - 1/10 + 0.005)
    expect(liquidationPrice("LONG", 20_000, 10, 0.005)).toBeCloseTo(18_100, 6);
    expect(liquidationPrice("SHORT", 20_000, 10, 0.005)).toBeCloseTo(21_900, 6);
    // Higher leverage puts liquidation closer to the entry.
    expect(liquidationPrice("LONG", 20_000, 50, 0.005)).toBeCloseTo(19_700, 6);
  });
});

describe("limit orders", () => {
  it("rests and reserves margin + maker fee off the free balance", () => {
    const res = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    );
    const a = res.account;
    expect(a.orders).toHaveLength(1);
    expect(a.orders[0].status).toBe("NEW");
    // 1_900 margin + 3.8 maker fee
    expect(a.balance).toBeCloseTo(8_096.2, 6);
    expect(a.positions).toHaveLength(0);
  });

  it("a buy limit fills when the tick reaches or crosses below the limit", () => {
    let a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    ).account;

    const above = evaluateTick(a, "BTCUSDT", 19_500, NOW + 1);
    expect(above.account.positions).toHaveLength(0);
    expect(above.account.orders[0].status).toBe("NEW");
    // Nothing happened: the very same account object comes back.
    expect(above.account).toBe(a);

    a = evaluateTick(a, "BTCUSDT", 19_000, NOW + 2).account;
    const p = pos(a);
    expect(p.entryPrice).toBe(19_000);
    expect(p.qty).toBe(1);
    expect(a.orders).toHaveLength(0);
    // Reserve released, then margin + maker fee charged for real.
    expect(a.balance).toBeCloseTo(8_096.2, 6);
    expect(p.feesPaid).toBeCloseTo(3.8, 6);
  });

  it("a sell limit fills when the tick reaches or crosses above the limit", () => {
    let a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, price: 21_000, leverage: 10 },
      NOW,
    ).account;
    expect(evaluateTick(a, "BTCUSDT", 20_500, NOW + 1).account.positions).toHaveLength(0);

    a = evaluateTick(a, "BTCUSDT", 21_000, NOW + 2).account;
    expect(pos(a).side).toBe("SHORT");
    expect(pos(a).entryPrice).toBe(21_000);
  });

  it("ignores ticks for another symbol", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    ).account;
    const res = evaluateTick(a, "ETHUSDT", 10, NOW + 1);
    expect(res.account).toBe(a);
    expect(res.events).toHaveLength(0);
  });

  it("carries the order's TP/SL onto the filled position", () => {
    let a = placeLimitOrder(
      acct(),
      {
        symbol: "BTCUSDT",
        side: "BUY",
        qty: 1,
        price: 19_000,
        leverage: 10,
        tp: 21_000,
        sl: 18_000,
      },
      NOW,
    ).account;
    a = evaluateTick(a, "BTCUSDT", 19_000, NOW + 1).account;
    expect(pos(a).tp).toBe(21_000);
    expect(pos(a).sl).toBe(18_000);
  });

  it("cancelling returns the reserved margin", () => {
    const placed = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    ).account;
    const a = cancelOrder(placed, placed.orders[0].id, NOW + 1).account;
    expect(a.orders).toHaveLength(0);
    expect(a.balance).toBeCloseTo(S.seedBalance, 6);
  });

  it("cancelling an unknown id is a no-op", () => {
    const a = acct();
    expect(cancelOrder(a, "nope", NOW).account).toBe(a);
  });

  it("rejects a limit whose reserve exceeds the free balance", () => {
    const res = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 100, price: 19_000, leverage: 10 },
      NOW,
    );
    expect(res.events[0].type).toBe("reject");
    expect(res.account.orders).toHaveLength(0);
    expect(res.account.balance).toBe(S.seedBalance);
  });
});

describe("per-tick bracket triggers", () => {
  it("closes a long at its stop-loss", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = { ...a, positions: [{ ...pos(a), sl: 19_000, tp: 22_000 }] };
    const res = evaluateTick(a, "BTCUSDT", 18_900, NOW + 1);
    expect(res.account.positions).toHaveLength(0);
    const t = res.account.history[0];
    expect(t.reason).toBe("SL");
    // Fills at the bracket price, not the tick that crossed it.
    expect(t.exitPrice).toBe(19_000);
    expect(t.grossPnl).toBeCloseTo(-1_000, 6);
  });

  it("closes a long at its take-profit", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = { ...a, positions: [{ ...pos(a), sl: 19_000, tp: 22_000 }] };
    const res = evaluateTick(a, "BTCUSDT", 22_500, NOW + 1);
    expect(res.account.history[0].reason).toBe("TP");
    expect(res.account.history[0].exitPrice).toBe(22_000);
  });

  it("closes a short at its brackets (mirrored conditions)", () => {
    let a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      20_000,
      NOW,
    ).account;
    a = { ...a, positions: [{ ...pos(a), sl: 21_000, tp: 19_000 }] };
    expect(evaluateTick(a, "BTCUSDT", 19_000, NOW + 1).account.history[0].reason).toBe("TP");
    expect(evaluateTick(a, "BTCUSDT", 21_500, NOW + 1).account.history[0].reason).toBe("SL");
  });

  it("gives the stop-loss precedence when both brackets cross on one tick", () => {
    // A stop trailed above the target is the only way a single price can
    // satisfy both a long's SL (price <= sl) and its TP (price >= tp).
    let a = openLong(acct(), 20_000, 1, 10);
    a = { ...a, positions: [{ ...pos(a), tp: 20_500, sl: 21_000 }] };
    const res = evaluateTick(a, "BTCUSDT", 20_700, NOW + 1);
    expect(res.account.history).toHaveLength(1);
    expect(res.account.history[0].reason).toBe("SL");
    expect(res.account.history[0].exitPrice).toBe(21_000);
  });

  it("triggers at most once per position per tick", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = { ...a, positions: [{ ...pos(a), tp: 20_500, sl: 21_000 }] };
    const res = evaluateTick(a, "BTCUSDT", 20_700, NOW + 1);
    expect(res.account.history).toHaveLength(1);
    expect(res.events.filter((e) => e.type === "close")).toHaveLength(1);
    // The position is gone, so a second tick changes nothing.
    const again = evaluateTick(res.account, "BTCUSDT", 20_700, NOW + 2);
    expect(again.account).toBe(res.account);
    expect(again.account.history).toHaveLength(1);
  });

  it("liquidates when the mark blows past the liquidation price", () => {
    const a = openLong(acct(), 20_000, 1, 10); // liq 18_100, no brackets
    const res = evaluateTick(a, "BTCUSDT", 18_000, NOW + 1);
    expect(res.account.positions).toHaveLength(0);
    expect(res.account.history[0].reason).toBe("LIQUIDATION");
    // The whole margin is gone; nothing beyond it is clawed back.
    expect(res.account.history[0].exitPrice).toBeCloseTo(18_100, 6);
  });

  it("is a cheap no-op when the symbol has no orders or positions", () => {
    const a = acct();
    const res = evaluateTick(a, "BTCUSDT", 20_000, NOW);
    expect(res.account).toBe(a);
    expect(res.events).toHaveLength(0);
  });

  it("is idempotent across repeated ticks at the same price", () => {
    const a = openLong(acct(), 20_000, 1, 10);
    const first = evaluateTick(a, "BTCUSDT", 20_500, NOW + 1);
    expect(first.account).toBe(a);
    const second = evaluateTick(first.account, "BTCUSDT", 20_500, NOW + 2);
    expect(second.account).toBe(a);
  });

  it("ignores non-finite or non-positive ticks", () => {
    const a = openLong(acct(), 20_000, 1, 10);
    expect(evaluateTick(a, "BTCUSDT", 0, NOW).account).toBe(a);
    expect(evaluateTick(a, "BTCUSDT", Number.NaN, NOW).account).toBe(a);
  });
});

describe("same-side merge liquidation (adversarial review finding 1)", () => {
  it("prices liquidation from the margin actually locked, not the last fill's leverage", () => {
    // A 2x core is overwhelmingly well-margined; adding a tiny 125x slice must
    // not drag its liquidation up near entry just because 125x was the *last*
    // leverage used.
    let a = createAccount({ seedBalance: 1_000_000 });
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty: 10, leverage: 2 }, 20_000, NOW)
      .account;
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "BUY", qty: 0.1, leverage: 125 },
      20_000,
      NOW + 1,
    ).account;
    const p = pos(a);
    expect(p.qty).toBeCloseTo(10.1, 6);
    // Overwriting leverage with 125 would have put this at ~19_940.
    expect(p.liquidationPrice).toBeCloseTo(10_197.43, 1);

    // True loss here is nowhere near the locked margin: must not liquidate.
    const res = evaluateTick(a, "BTCUSDT", 15_000, NOW + 2);
    expect(res.account.positions).toHaveLength(1);
    expect(res.account.history).toHaveLength(0);
  });

  it("liquidates a mostly-125x position dragged down by a tiny low-leverage add", () => {
    // The mirror image: overwriting leverage with the *last* fill's 2x would
    // have pushed liquidation all the way down to ~10_100, letting a thinly
    // margined position ride to a deeply negative equity.
    let a = createAccount({ seedBalance: 1_000_000 });
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty: 10, leverage: 125 }, 20_000, NOW)
      .account;
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "BUY", qty: 0.1, leverage: 2 },
      20_000,
      NOW + 1,
    ).account;
    const p = pos(a);
    expect(p.liquidationPrice).toBeCloseTo(19_842.57, 1);

    const res = evaluateTick(a, "BTCUSDT", 19_800, NOW + 2);
    expect(res.account.positions).toHaveLength(0);
    expect(res.account.history[0].reason).toBe("LIQUIDATION");
  });
});

describe("liquidation buffer clamp (adversarial review finding 5)", () => {
  it("clamps a negative buffer instead of putting liquidation on the wrong side of entry", () => {
    // maintMarginRate (0.01) exceeds 1/leverage (1/125 = 0.008): an
    // unclamped buffer would put a LONG's liquidation above entry (instant
    // liquidation) and a SHORT's below entry.
    expect(liquidationPrice("LONG", 20_000, 125, 0.01)).toBe(20_000);
    expect(liquidationPrice("SHORT", 20_000, 125, 0.01)).toBe(20_000);
  });
});

describe("bracket normalization on open (adversarial review finding 6)", () => {
  it("drops a stop-loss above entry and a take-profit below entry on a fresh LONG", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, sl: 21_000, tp: 19_000 },
      20_000,
      NOW,
    ).account;
    const p = pos(a);
    expect(p.sl).toBe(null);
    expect(p.tp).toBe(null);
  });

  it("drops a stop-loss below entry and a take-profit above entry on a fresh SHORT", () => {
    const a = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10, sl: 19_000, tp: 21_000 },
      20_000,
      NOW,
    ).account;
    const p = pos(a);
    expect(p.sl).toBe(null);
    expect(p.tp).toBe(null);
  });
});

describe("same-tick bracket evaluation (adversarial review finding 4)", () => {
  it("does not evaluate brackets against the tick price for a position this tick just opened", () => {
    // A SELL limit @19_000 with a valid SL above entry (19_500). A tick that
    // both crosses the limit and blows through 19_500 must not stop the
    // position out on the very tick that created it.
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 1, price: 19_000, leverage: 10, sl: 19_500 },
      NOW,
    ).account;

    const opened = evaluateTick(a, "BTCUSDT", 19_600, NOW + 1);
    expect(opened.account.positions).toHaveLength(1);
    expect(pos(opened.account).side).toBe("SHORT");
    expect(pos(opened.account).sl).toBe(19_500);
    expect(opened.account.history).toHaveLength(0);

    const stopped = evaluateTick(opened.account, "BTCUSDT", 19_500, NOW + 2);
    expect(stopped.account.positions).toHaveLength(0);
    expect(stopped.account.history[0].reason).toBe("SL");
  });
});

describe("rejected crossing orders (adversarial review finding 2)", () => {
  it("auto-cancels a resting order that a crash makes impossible to margin, refunding its reserve", () => {
    // BUY opens a small LONG. SELL rests far below it; when both cross on the
    // same catastrophic tick, the SELL first force-closes the LONG at a loss
    // deep enough to wipe the free balance, then can't afford to open the
    // short remainder — a reject that, left resting, would refire every tick.
    let a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    ).account;
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 2, price: 1, leverage: 10 },
      NOW,
    ).account;
    expect(a.orders).toHaveLength(2);
    const balanceBeforeCrash = a.balance;
    const secondOrderId = a.orders[1].id;

    const res = evaluateTick(a, "BTCUSDT", 1, NOW + 1);

    expect(res.account.orders).toHaveLength(0);
    expect(res.events.some((e) => e.type === "reject")).toBe(true);
    expect(
      res.events.some((e) => e.type === "cancel" && e.orderId === secondOrderId),
    ).toBe(true);
    // The reserve is back: balance only moved by the BUY's own fill economics,
    // never touched by the rejected SELL. (Finding 4's fix also keeps this
    // fresh position's brackets/liquidation from evaluating on this same
    // tick, so nothing else here moves the balance.)
    expect(res.account.balance).toBeCloseTo(balanceBeforeCrash + 0.2004, 6);

    // No reject storm: the order is gone, so a repeat tick can't reject again
    // (whatever else happens to the now-orphaned position is a separate path).
    const again = evaluateTick(res.account, "BTCUSDT", 1, NOW + 2);
    expect(again.events.some((e) => e.type === "reject")).toBe(false);
  });
});
