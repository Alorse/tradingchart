import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  formatPrice,
  formatPct,
  formatVolume,
  pricePrecisionFor,
  priceFormatFor,
  cappedPricePrecision,
  exchangePriceFormatFor,
  formatPriceInput,
  roundPriceForInput,
  formatDecimalInput,
  roundDecimalForInput,
  stepDecimals,
} from "./format";

describe("formatPrice", () => {
  it("uses thousands separators above 1000", () => {
    expect(formatPrice(60000)).toBe("60,000");
    expect(formatPrice(1234.567)).toBe("1,234.57");
  });
  it("scales decimals by magnitude, capped at 4", () => {
    expect(formatPrice(12.34)).toBe("12.34");
    expect(formatPrice(12.5)).toBe("12.50");
    expect(formatPrice(0.5)).toBe("0.5000");
    expect(formatPrice(0.1234)).toBe("0.1234");
    expect(formatPrice(0.0005)).toBe("0.0005");
  });
  it("switches to exponential once 4 decimals would round to zero", () => {
    expect(formatPrice(0.00005)).toBe("5.00e-5");
    expect(formatPrice(0.0000123)).toBe("1.23e-5");
  });
  it("returns an em dash for non-finite input", () => {
    expect(formatPrice(Infinity)).toBe("—");
    expect(formatPrice(NaN)).toBe("—");
  });
});

describe("pricePrecisionFor", () => {
  it("keeps 2 decimals for prices >= 1", () => {
    expect(pricePrecisionFor(64320.6)).toBe(2);
    expect(pricePrecisionFor(1)).toBe(2);
  });
  it("gives any sub-1 price 4 decimals", () => {
    // e.g. the chart's price scale used to flatten every symbol to 2
    // decimals, which showed a 0.0814 altcoin as "0.08".
    expect(pricePrecisionFor(0.0814)).toBe(4);
    expect(pricePrecisionFor(0.001)).toBe(4);
    expect(pricePrecisionFor(0.0001)).toBe(4);
    expect(pricePrecisionFor(0.00012)).toBe(4);
  });
  it("keeps 6 decimals below 0.0001 so the axis is not flat", () => {
    // The ruler cannot render the exponential notation formatPrice uses here.
    expect(pricePrecisionFor(0.00005)).toBe(6);
    expect(pricePrecisionFor(0.0000012)).toBe(6);
  });
  it("falls back to 2 for non-finite or zero input", () => {
    expect(pricePrecisionFor(0)).toBe(2);
    expect(pricePrecisionFor(NaN)).toBe(2);
  });
});

describe("priceFormatFor", () => {
  it("pairs precision with a matching minMove", () => {
    expect(priceFormatFor(0.0814)).toEqual({ precision: 4, minMove: 1e-4 });
    expect(priceFormatFor(0.00005)).toEqual({ precision: 6, minMove: 1e-6 });
    expect(priceFormatFor(64320.6)).toEqual({ precision: 2, minMove: 0.01 });
  });
});

describe("formatPct", () => {
  it("prefixes a sign", () => {
    expect(formatPct(2.5)).toBe("+2.50%");
    expect(formatPct(-1.2)).toBe("-1.20%");
    expect(formatPct(0)).toBe("+0.00%");
  });
});

describe("formatVolume", () => {
  it("abbreviates by magnitude", () => {
    expect(formatVolume(2_500_000_000)).toBe("2.50B");
    expect(formatVolume(3_400_000)).toBe("3.40M");
    expect(formatVolume(7_800)).toBe("7.80K");
    expect(formatVolume(42)).toBe("42.00");
  });
});

describe("cappedPricePrecision", () => {
  it("caps a sub-$1 coin's exchange precision at 4", () => {
    // The bug this exists for: the exchange quotes a cheap altcoin to 8
    // decimals, which overrode the magnitude guess's 4-decimal cap and left
    // the price ruler showing "0.00012340" instead of "0.0001".
    expect(cappedPricePrecision(0.0001234, 8)).toBe(4);
    expect(cappedPricePrecision(0.0814, 6)).toBe(4);
    expect(cappedPricePrecision(0.5, 5)).toBe(4);
  });
  it("keeps the exchange precision at $1 and above", () => {
    expect(cappedPricePrecision(3.421, 3)).toBe(3); // NEAR-like
    expect(cappedPricePrecision(64320.6, 1)).toBe(1); // BTC-like
    expect(cappedPricePrecision(2450.75, 2)).toBe(2); // ETH-like
    expect(cappedPricePrecision(1, 2)).toBe(2);
  });
  it("does not raise a sub-$1 coin already quoted below the cap", () => {
    expect(cappedPricePrecision(0.5, 2)).toBe(2);
  });
  it("falls back to the magnitude guess for a nonsense exchange precision", () => {
    expect(cappedPricePrecision(0.0814, NaN)).toBe(4);
    expect(cappedPricePrecision(64320.6, -1)).toBe(2);
  });
});

describe("exchangePriceFormatFor", () => {
  it("derives minMove from the capped precision, not the raw tick", () => {
    expect(exchangePriceFormatFor(0.0001234, 8)).toEqual({ precision: 4, minMove: 0.0001 });
  });
  it("passes an above-$1 precision through with a matching minMove", () => {
    expect(exchangePriceFormatFor(64320.6, 1)).toEqual({ precision: 1, minMove: 0.1 });
    expect(exchangePriceFormatFor(3.421, 3)).toEqual({ precision: 3, minMove: 0.001 });
  });
});

describe("formatPriceInput", () => {
  it("caps prices at/above $1 to 3 decimals", () => {
    expect(formatPriceInput(86234.123456789)).toBe("86234.123");
    expect(formatPriceInput(4.567890123456789)).toBe("4.568");
    expect(formatPriceInput(1)).toBe("1");
  });
  it("keeps 5 significant digits below $1", () => {
    expect(formatPriceInput(0.1234567890123)).toBe("0.12346");
    expect(formatPriceInput(0.000012345678)).toBe("0.000012346");
  });
  it("keeps sub-satoshi prices readable instead of flattening them to 0", () => {
    expect(formatPriceInput(0.0000000512)).toBe("0.0000000512");
    expect(formatPriceInput(5.12e-8)).toBe("0.0000000512");
    expect(formatPriceInput(5.12e-8)).not.toContain("e");
  });
  it("caps below-$1 prices at 12 decimals", () => {
    expect(formatPriceInput(1.23456789e-11)).toBe("0.000000000012");
    expect(formatPriceInput(1e-15)).toBe("0");
  });
  it("strips trailing zeros", () => {
    expect(formatPriceInput(86234.1)).toBe("86234.1");
    expect(formatPriceInput(2.5)).toBe("2.5");
    expect(formatPriceInput(0.5)).toBe("0.5");
    expect(formatPriceInput(100)).toBe("100");
  });
  it("rounds away binary float noise", () => {
    expect(formatPriceInput(2.675 + 1 * 0.001)).toBe("2.676");
    expect(formatPriceInput(2.6759999999999997)).toBe("2.676");
    expect(formatPriceInput(0.07 + 5 * 0.01)).toBe("0.12");
    expect(formatPriceInput(0.12000000000000001)).toBe("0.12");
    expect(formatPriceInput(86234.1 + 1 * 0.1)).toBe("86234.2");
    expect(formatPriceInput(86234.20000000001)).toBe("86234.2");
  });
  it("never uses thousands separators", () => {
    expect(formatPriceInput(1234567.891)).toBe("1234567.891");
  });
  it("applies the same rule to negative values", () => {
    expect(formatPriceInput(-4.567890123456789)).toBe("-4.568");
    expect(formatPriceInput(-0.000012345678)).toBe("-0.000012346");
    expect(formatPriceInput(-1e-15)).toBe("0");
  });
  it("renders 0 as '0' and non-finite input as an empty field", () => {
    expect(formatPriceInput(0)).toBe("0");
    expect(formatPriceInput(-0)).toBe("0");
    expect(formatPriceInput(NaN)).toBe("");
    expect(formatPriceInput(Infinity)).toBe("");
    expect(formatPriceInput(-Infinity)).toBe("");
  });
  it("widens to minDecimals so a fine tick survives the 3-decimal cap", () => {
    expect(formatPriceInput(2.1234, 4)).toBe("2.1234");
    expect(formatPriceInput(2.1234 + 0.0001, 4)).toBe("2.1235");
    expect(formatPriceInput(2.1234)).toBe("2.123");
    // minDecimals never narrows the default rule.
    expect(formatPriceInput(0.000012345678, 2)).toBe("0.000012346");
  });
});

describe("roundPriceForInput", () => {
  const cases = [
    86234.123456789, 4.567890123456789, 0.1234567890123, 0.000012345678,
    0.0000000512, 86234.1, 2.6759999999999997, 0.12000000000000001,
    86234.20000000001, -4.567890123456789, 0, 1e-15, -1e-15,
  ];
  it("returns a number whose string form matches the displayed text", () => {
    for (const c of cases) {
      const r = roundPriceForInput(c);
      expect(typeof r).toBe("number");
      expect(r).toBe(Number(formatPriceInput(c)));
      expect(formatPriceInput(r)).toBe(formatPriceInput(c));
    }
  });
  it("cleans the float-noise cases", () => {
    expect(roundPriceForInput(2.6759999999999997)).toBe(2.676);
    expect(roundPriceForInput(0.12000000000000001)).toBe(0.12);
    expect(roundPriceForInput(86234.20000000001)).toBe(86234.2);
    expect(roundPriceForInput(0.0000000512)).toBe(5.12e-8);
  });
  it("normalizes -0 to 0 and passes non-finite input through", () => {
    expect(Object.is(roundPriceForInput(-1e-15), 0)).toBe(true);
    expect(Number.isNaN(roundPriceForInput(NaN))).toBe(true);
    expect(roundPriceForInput(Infinity)).toBe(Infinity);
  });
  it("steps by exactly one tick per click without drifting", () => {
    let p = 86234.1;
    for (let i = 0; i < 1000; i++) p = roundPriceForInput(p + 0.1, stepDecimals(0.1));
    expect(p).toBe(86334.1);
    let q = 2.1234;
    for (let i = 0; i < 50; i++) q = roundPriceForInput(q + 0.0001, stepDecimals(0.0001));
    expect(q).toBe(2.1284);
    let r = 0.0000000512;
    for (let i = 0; i < 10; i++) r = roundPriceForInput(r - 1e-10, stepDecimals(1e-10));
    expect(r).toBe(5.02e-8);
  });
});

describe("formatDecimalInput / roundDecimalForInput", () => {
  it("rounds to the given decimals and strips trailing zeros", () => {
    expect(formatDecimalInput(0.1 + 0.2, 2)).toBe("0.3");
    expect(formatDecimalInput(12.5, 2)).toBe("12.5");
    expect(formatDecimalInput(1000, 2)).toBe("1000");
    expect(formatDecimalInput(3.7, 0)).toBe("4");
    expect(roundDecimalForInput(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundDecimalForInput(0.0010000000000000002, 6)).toBe(0.001);
  });
  it("handles 0, negatives and non-finite input", () => {
    expect(formatDecimalInput(0, 2)).toBe("0");
    expect(formatDecimalInput(-0.001, 2)).toBe("0");
    expect(formatDecimalInput(-2.345, 2)).toBe("-2.35");
    expect(formatDecimalInput(NaN, 2)).toBe("");
    expect(formatDecimalInput(Infinity, 2)).toBe("");
    expect(Number.isNaN(roundDecimalForInput(NaN, 2))).toBe(true);
  });
});

describe("stepDecimals", () => {
  it("counts the decimals a step carries", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(0.01)).toBe(2);
    expect(stepDecimals(0.00005)).toBe(5);
    expect(stepDecimals(1e-8)).toBe(8);
    expect(stepDecimals(0.0000001)).toBe(7);
  });
  it("returns 0 for non-positive or non-finite steps", () => {
    expect(stepDecimals(0)).toBe(0);
    expect(stepDecimals(-0.1)).toBe(0);
    expect(stepDecimals(NaN)).toBe(0);
  });
});
