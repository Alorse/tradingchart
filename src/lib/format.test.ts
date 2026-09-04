import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { formatPrice, formatPct, formatVolume, pricePrecisionFor, priceFormatFor } from "./format";

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
