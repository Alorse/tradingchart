import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  riskSizeFromInputs,
  qtyFromRisk,
  qtyFromLeverage,
  positionQty,
  pnlAtLevel,
  balanceAfter,
  offsetPct,
  offsetTicks,
  rewardRiskRatio,
  openPnl,
  openPnlCurrency,
  deriveQuoteCurrency,
} from "./position-math";

describe("riskSizeFromInputs", () => {
  it("passes through a flat USD risk", () => {
    expect(riskSizeFromInputs(10000, 200, false)).toBe(200);
  });
  it("resolves a percent risk against account size", () => {
    expect(riskSizeFromInputs(10000, 2, true)).toBe(200);
  });
  it("is 0 for zero, missing, or negative risk", () => {
    expect(riskSizeFromInputs(10000, 0, false)).toBe(0);
    expect(riskSizeFromInputs(10000, -5, false)).toBe(0);
    expect(riskSizeFromInputs(10000, NaN, false)).toBe(0);
  });
});

describe("qtyFromRisk", () => {
  it("divides risk budget by price distance, in lots", () => {
    // $200 risk / $10 stop distance = 20 base units; lotSize 1 -> 20 lots
    expect(qtyFromRisk(100, 90, 200, 1, 1)).toBe(20);
  });
  it("divides by lotSize when a lot represents more than one base unit", () => {
    expect(qtyFromRisk(100, 90, 200, 1, 10)).toBe(2);
  });
  it("scales inversely with pointValue", () => {
    expect(qtyFromRisk(100, 90, 200, 2, 1)).toBe(10);
  });
  it("guards zero entry/stop distance", () => {
    expect(qtyFromRisk(100, 100, 200)).toBe(0);
  });
  it("guards zero or missing risk size", () => {
    expect(qtyFromRisk(100, 90, 0)).toBe(0);
  });
});

describe("qtyFromLeverage", () => {
  it("sizes from account size * leverage / entry", () => {
    // 10000 * 5 / 100 = 500 base units
    expect(qtyFromLeverage(100, 10000, 5, 1, 1)).toBe(500);
  });
  it("divides by lotSize", () => {
    expect(qtyFromLeverage(100, 10000, 5, 1, 10)).toBe(50);
  });
  it("guards a zero entry price", () => {
    expect(qtyFromLeverage(0, 10000, 5)).toBe(0);
  });
  it("guards missing leverage/account size", () => {
    expect(qtyFromLeverage(100, 10000, 0)).toBe(0);
    expect(qtyFromLeverage(100, 0, 5)).toBe(0);
  });
});

describe("positionQty", () => {
  it("is null when accountSize/risk are unset (hide qty/money stats)", () => {
    expect(positionQty({ entry: 100, stop: 90 })).toBe(null);
    expect(positionQty({ entry: 100, stop: 90, accountSize: 10000 })).toBe(null);
  });
  it("takes the smaller of risk-sized and leverage-capped qty", () => {
    // risk sizing wants 20, leverage caps at 5 (10000*0.05/100)
    const q = positionQty({
      entry: 100,
      stop: 90,
      accountSize: 10000,
      risk: 200,
      leverage: 0.05,
    });
    expect(q).toBeCloseTo(5, 5);
  });
  it("falls back to risk-only sizing when leverage is unset", () => {
    const q = positionQty({
      entry: 100,
      stop: 90,
      accountSize: 10000,
      risk: 200,
    });
    expect(q).toBe(20);
  });
  it("resolves an explicit 0 risk to 0 qty rather than hiding stats", () => {
    expect(
      positionQty({ entry: 100, stop: 90, accountSize: 10000, risk: 0 }),
    ).toBe(0);
  });
});

describe("pnlAtLevel / balanceAfter", () => {
  it("is positive for a long hitting target above entry", () => {
    expect(pnlAtLevel(100, 110, 10, "long")).toBe(100);
  });
  it("is negative for a long hitting stop below entry", () => {
    expect(pnlAtLevel(100, 90, 10, "long")).toBe(-100);
  });
  it("mirrors sign for a short", () => {
    expect(pnlAtLevel(100, 90, 10, "short")).toBe(100);
    expect(pnlAtLevel(100, 110, 10, "short")).toBe(-100);
  });
  it("scales with pointValue", () => {
    expect(pnlAtLevel(100, 110, 10, "long", 2)).toBe(200);
  });
  it("balanceAfter adds signed pnl to account size", () => {
    expect(balanceAfter(10000, 100)).toBe(10100);
    expect(balanceAfter(10000, -100)).toBe(9900);
  });
});

describe("offsetPct / offsetTicks / rewardRiskRatio", () => {
  it("computes signed percent offset", () => {
    expect(offsetPct(100, 110)).toBeCloseTo(10, 5);
    expect(offsetPct(100, 90)).toBeCloseTo(-10, 5);
  });
  it("computes signed whole-tick offset", () => {
    expect(offsetTicks(100, 100.5, 0.1)).toBe(5);
    expect(offsetTicks(100, 99.5, 0.1)).toBe(-5);
  });
  it("computes reward:risk from entry/stop/target", () => {
    expect(rewardRiskRatio(100, 90, 120)).toBeCloseTo(2, 5);
  });
});

describe("openPnl / openPnlCurrency", () => {
  it("is positive when price moves toward a long's target", () => {
    expect(openPnl(100, 110, "long")).toBe(10);
    expect(openPnl(100, 90, "long")).toBe(-10);
  });
  it("mirrors for a short", () => {
    expect(openPnl(100, 90, "short")).toBe(10);
    expect(openPnl(100, 110, "short")).toBe(-10);
  });
  it("currency version scales by qty and pointValue", () => {
    expect(openPnlCurrency(100, 110, 5, "long")).toBe(50);
    expect(openPnlCurrency(100, 110, 5, "long", 2)).toBe(100);
  });
});

describe("deriveQuoteCurrency", () => {
  it("strips the BYBIT: prefix and .P perp suffix", () => {
    expect(deriveQuoteCurrency("BYBIT:SOLUSDT.P")).toBe("USDT");
  });
  it("matches other known quote assets", () => {
    expect(deriveQuoteCurrency("BTCUSDC")).toBe("USDC");
    expect(deriveQuoteCurrency("ETHBUSD")).toBe("BUSD");
  });
  it("falls back to USDT for an unrecognized suffix", () => {
    expect(deriveQuoteCurrency("AAPL")).toBe("USDT");
  });
});
