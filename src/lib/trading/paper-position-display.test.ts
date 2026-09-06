import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { fillMarketOrder, createAccount } from "@/lib/trading/paper-engine";
import {
  computePositionFigures,
  positionFiguresAt,
  formatPnlDisplay,
  isLiquidationUrgent,
  pnlDisplayValue,
} from "./paper-position-display";
import type { PaperPosition } from "@/lib/trading/paper-engine";

const NOW = 1_700_000_000_000;

function longAt(entry: number, leverage = 10): PaperPosition {
  const account = fillMarketOrder(
    createAccount(),
    { symbol: "BTCUSDT", side: "BUY", qty: 1, leverage },
    entry,
    NOW,
  ).account;
  const p = account.positions.find((x) => x.symbol === "BTCUSDT");
  if (!p) throw new Error("no position");
  return p;
}

function shortAt(entry: number, leverage = 10): PaperPosition {
  const account = fillMarketOrder(
    createAccount(),
    { symbol: "BTCUSDT", side: "SELL", qty: 1, leverage },
    entry,
    NOW,
  ).account;
  const p = account.positions.find((x) => x.symbol === "BTCUSDT");
  if (!p) throw new Error("no position");
  return p;
}

describe("pnlDisplayValue", () => {
  it("MONEY matches unrealizedPnl", () => {
    const p = longAt(20_000);
    expect(pnlDisplayValue(p, 20_500, "MONEY", 0.1)).toBeCloseTo(500, 6);
  });

  it("TICKS divides the price delta by tick size, signed by direction", () => {
    const long = longAt(20_000);
    expect(pnlDisplayValue(long, 20_050, "TICKS", 0.1)).toBeCloseTo(500, 6);
    const short = shortAt(20_000);
    // Price rose against a short: negative ticks.
    expect(pnlDisplayValue(short, 20_050, "TICKS", 0.1)).toBeCloseTo(-500, 6);
  });

  it("TICKS is zero when tickSize is not positive", () => {
    const p = longAt(20_000);
    expect(pnlDisplayValue(p, 20_500, "TICKS", 0)).toBe(0);
  });

  it("PERCENT is the price move, signed by direction, not leveraged", () => {
    const long = longAt(20_000);
    expect(pnlDisplayValue(long, 20_200, "PERCENT", 0.1)).toBeCloseTo(1, 6);
    const short = shortAt(20_000);
    expect(pnlDisplayValue(short, 20_200, "PERCENT", 0.1)).toBeCloseTo(-1, 6);
  });
});

describe("formatPnlDisplay", () => {
  it("formats MONEY with a sign and USDT suffix", () => {
    expect(formatPnlDisplay(12.5, "MONEY")).toBe("+12.50 USDT");
    expect(formatPnlDisplay(-3, "MONEY")).toBe("-3.00 USDT");
  });

  it("formats TICKS as a whole-number count", () => {
    expect(formatPnlDisplay(4.7, "TICKS")).toBe("+5 ticks");
  });

  it("formats PERCENT with two decimals", () => {
    expect(formatPnlDisplay(-1.5, "PERCENT")).toBe("-1.50%");
  });
});

describe("isLiquidationUrgent", () => {
  it("is false with no liquidation price", () => {
    const p = { ...longAt(20_000), liquidationPrice: 0 };
    expect(isLiquidationUrgent(p, 19_000)).toBe(false);
  });

  it("is false when the mark is far from liquidation", () => {
    const p = longAt(20_000); // liq around 18,100 at 10x
    expect(isLiquidationUrgent(p, 20_000)).toBe(false);
  });

  it("is true within 10% of the entry-to-liquidation distance", () => {
    const p = longAt(20_000);
    const distance = Math.abs(p.entryPrice - p.liquidationPrice);
    const closeMark = p.liquidationPrice + distance * 0.05;
    expect(isLiquidationUrgent(p, closeMark)).toBe(true);
  });

  it("is false just outside the 10% threshold", () => {
    const p = longAt(20_000);
    const distance = Math.abs(p.entryPrice - p.liquidationPrice);
    const farMark = p.liquidationPrice + distance * 0.2;
    expect(isLiquidationUrgent(p, farMark)).toBe(false);
  });
});

describe("computePositionFigures", () => {
  it("falls back to entry price when the symbol hasn't ticked yet", () => {
    const p = longAt(20_000);
    const figures = computePositionFigures(p, {}, "MONEY", 0.1);
    expect(figures.mark).toBe(20_000);
    expect(figures.pnl).toBe(0);
    expect(figures.displaySymbol).toBe("BTCUSDT");
  });

  it("prefers feedSymbol for display when present", () => {
    const p = { ...longAt(20_000), feedSymbol: "BYBIT:BTCUSDT.P" };
    const figures = computePositionFigures(p, { BTCUSDT: 21_000 }, "MONEY", 0.1);
    expect(figures.displaySymbol).toBe("BYBIT:BTCUSDT.P");
    expect(figures.mark).toBe(21_000);
  });
});

describe("positionFiguresAt", () => {
  it("applies the same entry-price fallback for an undefined mark", () => {
    const p = longAt(20_000);
    expect(positionFiguresAt(p, undefined, "MONEY", 0.1)).toEqual(
      computePositionFigures(p, {}, "MONEY", 0.1),
    );
  });

  it("matches computePositionFigures for a symbol that has ticked", () => {
    const p = longAt(20_000);
    expect(positionFiguresAt(p, 21_000, "MONEY", 0.1)).toEqual(
      computePositionFigures(p, { BTCUSDT: 21_000 }, "MONEY", 0.1),
    );
  });
});
