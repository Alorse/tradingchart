import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  DEFAULT_PAPER_SETTINGS,
  MAX_LEVERAGE,
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
  updateSettings,
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
  it("does not evaluate a freshly-opened position's liquidation on the tick that opened it", () => {
    // maintMarginRate == 1/leverage clamps the liquidation buffer to zero, so
    // liquidationPrice lands exactly on the entry price — the position opens
    // already "at" its own liquidation level. (A tp/sl can't set up this
    // same-tick edge case any more: since adversarial re-audit finding 1,
    // a crossing limit fills at the tick price, and open-time bracket
    // normalization checks against that same price, so a bracket that
    // survives normalization can never immediately trigger — see the
    // re-audit finding 1/3 tests below. Liquidation has no such
    // normalization, so this is the one case left where "just opened" still
    // matters.)
    let a = createAccount({ maintMarginRate: 0.1 });
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    ).account;

    const opened = evaluateTick(a, "BTCUSDT", 19_000, NOW + 1);
    expect(opened.account.positions).toHaveLength(1);
    expect(pos(opened.account).liquidationPrice).toBe(19_000);
    // Liquidation price already equals the tick that opened it — a bracket
    // pass that ran anyway would liquidate it on the spot.
    expect(opened.account.history).toHaveLength(0);

    // The very next tick, at the same price, is a different story: the
    // position now existed *before* this tick, so its liquidation is live.
    const again = evaluateTick(opened.account, "BTCUSDT", 19_000, NOW + 2);
    expect(again.account.positions).toHaveLength(0);
    expect(again.account.history[0].reason).toBe("LIQUIDATION");
    expect(again.account.history[0].exitPrice).toBe(19_000);
  });
});

describe("rejected crossing orders (adversarial review finding 2)", () => {
  // Rewritten for adversarial re-audit finding 1: a crossing limit now fills
  // at the tick price rather than its own resting price (see the
  // "crossing limit fills at the tick price" describe block below), so the
  // original version of this test — a SELL resting at 1 that "force-closed"
  // an unrelated LONG at exactly 1 — no longer demonstrates an overdraw at
  // all once both legs price off the same tick. This realistic replacement
  // exercises the *other* half of the same auto-cancel mechanism: a resting
  // order whose reserve was sized off its own (lower) resting price, crossed
  // by a gap tick so far above it that the position it would open needs far
  // more margin than was ever reserved.
  it("auto-cancels a resting order whose reserve a gap tick outgrows, refunding it", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "SELL", qty: 3, price: 1_000, leverage: 10 },
      NOW,
    ).account;
    const orderId = a.orders[0].id;
    const balanceBeforeGap = a.balance;

    // A violent short-squeeze gap, far above the resting price that sized
    // the reserve.
    const res = evaluateTick(a, "BTCUSDT", 50_000, NOW + 1);

    expect(res.account.orders).toHaveLength(0);
    expect(res.events.some((e) => e.type === "reject")).toBe(true);
    expect(res.events.some((e) => e.type === "cancel" && e.orderId === orderId)).toBe(
      true,
    );
    // Reserve refunded in full; nothing else touched the balance.
    expect(res.account.balance).toBeCloseTo(balanceBeforeGap + 300.6, 6);
    expect(res.account.positions).toHaveLength(0);

    // No reject storm: the order is gone, so a repeat tick can't reject again.
    const again = evaluateTick(res.account, "BTCUSDT", 50_000, NOW + 2);
    expect(again.events.some((e) => e.type === "reject")).toBe(false);
  });
});

describe("crossing limit fills at the tick price (adversarial re-audit finding 1)", () => {
  it("fills a crossing limit at the tick price, not its own resting price", () => {
    // A SELL limit resting well below market, as if mistaken for a stop.
    // Before this fix it filled at its own 15_000, booking a $5,000 phantom
    // loss on an ordinary tick that barely moved the market.
    let a = openLong(acct(), 20_000, 1, 10);
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 1, price: 15_000, leverage: 10 },
      NOW,
    ).account;

    const res = evaluateTick(a, "BTCUSDT", 19_999, NOW + 1);
    const trade = res.account.history[0];
    expect(trade.exitPrice).toBe(19_999);
    expect(trade.grossPnl).toBeCloseTo(-1, 6);
    expect(res.account.positions).toHaveLength(0);
    expect(res.account.balance).toBeCloseTo(9_985.0002, 6);
  });

  it("refuses a reducing crossing fill that would overdraw the account on a gap tick, leaving liquidation to settle it at its clamped price", () => {
    // Thin margin (125x): a SELL limit resting far below market never fires
    // while price stays above it, but a violent single-tick gap can cross it
    // at a tick price whose loss is far deeper than the position's own
    // margin — even though the fill price is now the (real, no-look-ahead)
    // tick, not a phantom order price.
    let a = openLong(acct(), 20_000, 1, 125);
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 1, price: 100, leverage: 10 },
      NOW,
    ).account;
    const orderId = a.orders[0].id;

    const res = evaluateTick(a, "BTCUSDT", 150, NOW + 1);

    // The reducing fill is refused whole rather than booking a loss deeper
    // than the position's margin, and auto-cancelled like any other crossing
    // order the account can't afford.
    expect(res.events[0].type).toBe("reject");
    expect(res.events.some((e) => e.type === "cancel" && e.orderId === orderId)).toBe(
      true,
    );
    expect(res.account.orders).toHaveLength(0);

    // The position itself is liquidated on the very same tick — its id
    // survived the rejected fill untouched — settling at the computed
    // liquidation price, never at the raw gap price.
    expect(res.account.positions).toHaveLength(0);
    const trade = res.account.history[0];
    expect(trade.reason).toBe("LIQUIDATION");
    expect(trade.exitPrice).toBe(19_940);
    expect(res.account.balance).toBeCloseTo(9_920.03, 6);
  });
});

describe("wrong-side brackets on a merge (adversarial re-audit finding 2)", () => {
  it("drops a merge's blended-in stop that sits on the wrong side of the fill price", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    // Adding to the LONG with an SL *above* the fill price books a gain the
    // instant price so much as ticks, mislabelled as a stop-out.
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage: 10, sl: 25_000 },
      20_000,
      NOW + 1,
    ).account;
    expect(pos(a).sl).toBe(null);

    const res = evaluateTick(a, "BTCUSDT", 20_000, NOW + 2);
    expect(res.account.positions).toHaveLength(1);
    expect(res.account.history).toHaveLength(0);
  });
});

describe("same-tick bracket evaluation for a merge (adversarial re-audit finding 3)", () => {
  it("does not evaluate a merge's newly-set bracket against the tick that just set it", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10, sl: 19_200 },
      NOW,
    ).account;

    // Fills the merge and, if brackets were evaluated on this same tick,
    // would also blow through the just-set 19_200 stop — except 19_200 sits
    // on the wrong side of the 19_000 fill price for a LONG (it's already
    // behind where the price just was), so re-audit finding 2 drops it
    // before this pass ever runs.
    const res = evaluateTick(a, "BTCUSDT", 19_000, NOW + 1);
    expect(res.account.positions).toHaveLength(1);
    expect(pos(res.account).sl).toBe(null);
    expect(res.account.history).toHaveLength(0);
  });

  // There is deliberately no "a merge's untouched, still-live bracket fires
  // on the same tick" counterpart here: since re-audit finding 2 also
  // re-validates a *carried-over* sl/tp (not just a newly-supplied one)
  // against the fill price, any bracket a merge keeps is, by construction,
  // valid relative to that same price — and `triggeredExit`'s trigger
  // condition is the strict complement of `normalizeBrackets`'s validity
  // condition, so a bracket that survives can never also satisfy the
  // trigger at that identical price. The snapshot-compare here is
  // belt-and-suspenders against that invariant ever drifting (e.g. a future
  // change to `setBrackets` or `normalizeBrackets` that stops re-validating
  // a carried-over value), not something a same-tick test can observe today.
});

describe("event payloads and flips against a resting order (adversarial review finding 11)", () => {
  it("a market fill's event carries a null orderId and a taker fee proportional to qty*price*rate", () => {
    const res = fillMarketOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 2, leverage: 10 },
      20_000,
      NOW,
    );
    const fill = res.events.find((e) => e.type === "fill");
    if (!fill || fill.type !== "fill") throw new Error("expected a fill event");
    expect(fill.orderId).toBe(null);
    expect(fill.fee).toBeCloseTo(2 * 20_000 * S.takerFeeRate, 6);
  });

  it("a limit fill's event carries the resting order's id and the maker fee", () => {
    const a = placeLimitOrder(
      acct(),
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 19_000, leverage: 10 },
      NOW,
    ).account;
    const orderId = a.orders[0].id;

    const res = evaluateTick(a, "BTCUSDT", 19_000, NOW + 1);
    const fill = res.events.find((e) => e.type === "fill");
    if (!fill || fill.type !== "fill") throw new Error("expected a fill event");
    expect(fill.orderId).toBe(orderId);
    expect(fill.fee).toBeCloseTo(1 * 19_000 * S.makerFeeRate, 6);
  });

  it("flips a position via market order while a resting limit on the same symbol is untouched", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = placeLimitOrder(
      a,
      { symbol: "BTCUSDT", side: "BUY", qty: 1, price: 18_000, leverage: 10 },
      NOW,
    ).account;
    expect(a.orders).toHaveLength(1);

    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 3, leverage: 10 },
      21_000,
      NOW + 1,
    ).account;
    const p = pos(a);
    expect(p.side).toBe("SHORT");
    expect(p.qty).toBeCloseTo(2, 8);
    // The unrelated resting order survives the flip untouched.
    expect(a.orders).toHaveLength(1);
    expect(a.orders[0].price).toBe(18_000);
  });
});

describe("setBrackets reference-price validation (adversarial re-audit finding 2)", () => {
  it("drops a setBrackets stop that sits on the wrong side of the reference price", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = setBrackets(a, "BTCUSDT", { sl: 30_000 }, 20_000);
    expect(pos(a).sl).toBe(null);

    const res = evaluateTick(a, "BTCUSDT", 20_000, NOW + 1);
    expect(res.account.positions).toHaveLength(1);
    expect(res.account.history).toHaveLength(0);
  });

  it("setBrackets falls back to the position's entry price when no reference is given", () => {
    let a = openLong(acct(), 20_000, 1, 10);
    a = setBrackets(a, "BTCUSDT", { sl: 21_000 }); // above entry on a LONG: invalid
    expect(pos(a).sl).toBe(null);

    a = openLong(acct(), 20_000, 1, 10);
    a = setBrackets(a, "BTCUSDT", { sl: 19_000 }); // below entry on a LONG: valid
    expect(pos(a).sl).toBe(19_000);
  });
});

describe("updateSettings validation (adversarial re-audit finding 5)", () => {
  it("ignores a negative fee rate, keeping the previous value", () => {
    const a = updateSettings(acct(), { takerFeeRate: -1 });
    expect(a.settings.takerFeeRate).toBe(S.takerFeeRate);
  });

  it("ignores a fee rate above the 1% ceiling", () => {
    const a = updateSettings(acct(), { makerFeeRate: 0.02 });
    expect(a.settings.makerFeeRate).toBe(S.makerFeeRate);
  });

  it("ignores a NaN maintenance margin rate rather than zeroing every liquidation buffer", () => {
    const a = updateSettings(acct(), { maintMarginRate: Number.NaN });
    expect(a.settings.maintMarginRate).toBe(S.maintMarginRate);
  });

  it("ignores a maintenance margin rate at or above 1/MAX_LEVERAGE", () => {
    const a = updateSettings(acct(), { maintMarginRate: 1 / MAX_LEVERAGE });
    expect(a.settings.maintMarginRate).toBe(S.maintMarginRate);
  });

  it("ignores a NaN or non-positive seed balance rather than bricking the account", () => {
    let a = updateSettings(acct(), { seedBalance: Number.NaN });
    expect(a.settings.seedBalance).toBe(S.seedBalance);
    a = updateSettings(acct(), { seedBalance: -100 });
    expect(a.settings.seedBalance).toBe(S.seedBalance);
    a = updateSettings(acct(), { seedBalance: 0 });
    expect(a.settings.seedBalance).toBe(S.seedBalance);
  });

  it("clamps a non-finite default leverage instead of dropping it, same as a per-order leverage", () => {
    const a = updateSettings(acct(), { defaultLeverage: Number.NaN });
    expect(a.settings.defaultLeverage).toBe(S.defaultLeverage);
    const hi = updateSettings(acct(), { defaultLeverage: 1_000 });
    expect(hi.settings.defaultLeverage).toBe(125);
  });

  it("accepts a valid patch and leaves untouched keys alone", () => {
    const a = updateSettings(acct(), { takerFeeRate: 0.001 });
    expect(a.settings.takerFeeRate).toBe(0.001);
    expect(a.settings.makerFeeRate).toBe(S.makerFeeRate);
  });
});

describe("fill event fee semantics and ordering (adversarial re-audit finding 6)", () => {
  it("reports zero fee on a fill event for a pure reduce, since the exit fee is already in the close's trade.fees", () => {
    const a = openLong(acct(), 20_000, 2, 10);
    const res = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      20_000,
      NOW + 1,
    );
    const fill = res.events.find((e) => e.type === "fill");
    const close = res.events.find((e) => e.type === "close");
    if (!fill || fill.type !== "fill" || !close || close.type !== "close") {
      throw new Error("expected both a fill and a close event");
    }
    expect(fill.fee).toBe(0);
    expect(close.trade.fees).toBeGreaterThan(0);
  });

  it("emits the fill event before the close event it caused", () => {
    const a = openLong(acct(), 20_000, 1, 10);
    const res = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage: 10 },
      21_000,
      NOW + 1,
    );
    expect(res.events.map((e) => e.type)).toEqual(["fill", "close"]);
  });

  it("reports only the opening leg's fee on a flip's single fill event", () => {
    const a = openLong(acct(), 20_000, 1, 10);
    const res = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 3, leverage: 10 },
      21_000,
      NOW + 1,
    );
    const fill = res.events.find((e) => e.type === "fill");
    if (!fill || fill.type !== "fill") throw new Error("expected a fill event");
    // qty on the event is the full requested size...
    expect(fill.qty).toBe(3);
    // ...but the fee is only the 2-unit opening leg's, since the 1-unit
    // reducing leg's fee already rode along inside the close event.
    expect(fill.fee).toBeCloseTo(2 * 21_000 * S.takerFeeRate, 6);
  });
});

describe("floating-point dust after full netting (adversarial re-audit finding 7)", () => {
  it("does not leave a dust-sized phantom position after netting to exactly flat", () => {
    let a = createAccount();
    a = fillMarketOrder(a, { symbol: "BTCUSDT", side: "BUY", qty: 0.3, leverage: 10 }, 20_000, NOW)
      .account;
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 0.1, leverage: 10 },
      20_000,
      NOW + 1,
    ).account;
    a = fillMarketOrder(
      a,
      { symbol: "BTCUSDT", side: "SELL", qty: 0.2, leverage: 10 },
      20_000,
      NOW + 2,
    ).account;
    expect(a.positions).toHaveLength(0);
  });
});
