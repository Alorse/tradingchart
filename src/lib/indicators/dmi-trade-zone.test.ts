import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { dmiTradeZone, dmiZoneSpans, type DmiTradeZonePoint } from "./dmi-trade-zone";
import { adx } from "./adx";
import type { Candle } from "@/lib/binance/types";

/** Build OHLC candles from a close series, with a small symmetric range. */
function ohlc(closes: number[]): Candle[] {
  return closes.map((c, i) => {
    const prev = i === 0 ? c : closes[i - 1];
    return {
      time: i * 60,
      open: prev,
      high: Math.max(prev, c) + 0.5,
      low: Math.min(prev, c) - 0.5,
      close: c,
      volume: 1,
      isFinal: true,
    };
  });
}

const uptrend = ohlc(Array.from({ length: 60 }, (_, i) => 100 + i));
const downtrend = ohlc(Array.from({ length: 60 }, (_, i) => 160 - i));

describe("dmiTradeZone", () => {
  it("returns the same DMI numbers as adx() — it only adds the zone flag", () => {
    const base = adx(uptrend, { diLen: 14, adxLen: 14 });
    const out = dmiTradeZone(uptrend, { diLen: 14, adxLen: 14 });
    expect(out.length).toBe(base.length);
    out.forEach((p, i) => {
      expect(p.time).toBe(base[i].time);
      expect(p.adx).toBe(base[i].adx);
      expect(p.plusDI).toBe(base[i].plusDI);
      expect(p.minusDI).toBe(base[i].minusDI);
    });
  });

  it("defaults to Pine's 14 / 14", () => {
    expect(dmiTradeZone(uptrend)).toEqual(dmiTradeZone(uptrend, { diLen: 14, adxLen: 14 }));
  });

  it("produces bounded ADX and finite DI values", () => {
    const out = dmiTradeZone(uptrend);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.adx).toBeGreaterThan(-0.0001);
      expect(p.adx).toBeLessThan(100.0001);
      expect(Number.isFinite(p.plusDI)).toBe(true);
      expect(Number.isFinite(p.minusDI)).toBe(true);
    }
  });

  it("flags every bar of a clean uptrend bullish (+DI dominates)", () => {
    const out = dmiTradeZone(uptrend);
    expect(out.every((p) => p.bullish)).toBe(true);
    expect(out.every((p) => p.plusDI > p.minusDI)).toBe(true);
  });

  it("flags every bar of a clean downtrend not-bullish (-DI dominates)", () => {
    const out = dmiTradeZone(downtrend);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((p) => p.bullish)).toBe(false);
    expect(out.every((p) => p.minusDI > p.plusDI)).toBe(true);
  });

  it("flips the flag when a trend reverses mid-series", () => {
    // 60 bars up, then 60 back down: the zone must both open and close.
    const reversal = ohlc([
      ...Array.from({ length: 60 }, (_, i) => 100 + i),
      ...Array.from({ length: 60 }, (_, i) => 159 - i),
    ]);
    const out = dmiTradeZone(reversal);
    expect(out.some((p) => p.bullish)).toBe(true);
    expect(out.some((p) => !p.bullish)).toBe(true);
    expect(out[0].bullish).toBe(true);
    expect(out[out.length - 1].bullish).toBe(false);
  });

  it("converges on ADX 100 when a trend never produces a single -DM", () => {
    // Every bar of `uptrend` makes a higher high and a higher low, so -DM is 0
    // throughout: -DI is 0, dx is a constant 100, and Wilder's RMA walks ADX
    // up towards 100 from its SMA seed.
    const out = dmiTradeZone(uptrend);
    expect(out.every((p) => p.minusDI === 0)).toBe(true);
    expect(out.every((p) => p.plusDI > 0)).toBe(true);
    const last = out[out.length - 1];
    expect(last.adx).toBeGreaterThan(95);
    expect(last.adx).toBeLessThan(100.0001);
    // Monotonically rising, since each new dx (100) is at or above the running mean.
    for (let i = 1; i < out.length; i++) {
      expect(out[i].adx).toBeGreaterThan(out[i - 1].adx - 1e-9);
    }
  });

  it("reads a zero DI sum as dx = 0, matching Pine's `sum == 0 ? 1 : sum` guard", () => {
    // Identical bars with a real high-low range: TR is non-zero (so the DI
    // division is defined) but neither +DM nor -DM ever fires, leaving
    // +DI == -DI == 0. Pine divides |0 - 0| by the substituted 1; this
    // implementation skips the division and feeds the RMA a 0. Same number.
    const boxed: Candle[] = Array.from({ length: 80 }, (_, i) => ({
      time: i * 60, open: 100, high: 101, low: 99, close: 100, volume: 1, isFinal: true,
    }));
    const out = dmiTradeZone(boxed);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.plusDI).toBe(0);
      expect(p.minusDI).toBe(0);
      expect(p.adx).toBe(0);
      // `diplus > diminus` is false on a tie, so no zone — as in the Pine.
      expect(p.bullish).toBe(false);
    }
    expect(dmiZoneSpans(out)).toEqual([]);
  });

  it("returns nothing before the warm-up completes", () => {
    expect(dmiTradeZone(ohlc([100, 101, 102]))).toEqual([]);
  });
});

/** Minimal point, since dmiZoneSpans only reads `time` and `bullish`. */
function pt(time: number, bullish: boolean): DmiTradeZonePoint {
  return { time, adx: 0, plusDI: 0, minusDI: 0, bullish };
}

describe("dmiZoneSpans", () => {
  it("returns nothing for no points", () => {
    expect(dmiZoneSpans([])).toEqual([]);
  });

  it("returns nothing when no bar is bullish", () => {
    expect(dmiZoneSpans([pt(1, false), pt(2, false)])).toEqual([]);
  });

  it("collapses one contiguous run into a single span", () => {
    const spans = dmiZoneSpans([pt(1, false), pt(2, true), pt(3, true), pt(4, true), pt(5, false)]);
    expect(spans).toEqual([{ from: 2, to: 4 }]);
  });

  it("keeps separate runs separate", () => {
    const spans = dmiZoneSpans([
      pt(1, true), pt(2, true),
      pt(3, false),
      pt(4, true),
      pt(5, false),
      pt(6, true), pt(7, true),
    ]);
    expect(spans).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 4 },
      { from: 6, to: 7 },
    ]);
  });

  it("closes a run that is still open on the last bar", () => {
    expect(dmiZoneSpans([pt(1, false), pt(2, true), pt(3, true)])).toEqual([{ from: 2, to: 3 }]);
  });

  it("handles a single bullish bar", () => {
    expect(dmiZoneSpans([pt(7, true)])).toEqual([{ from: 7, to: 7 }]);
  });

  it("covers every bullish bar and no other", () => {
    const pts = Array.from({ length: 40 }, (_, i) => pt(i, i % 7 < 3));
    const spans = dmiZoneSpans(pts);
    for (const p of pts) {
      const covered = spans.some((s) => p.time >= s.from && p.time <= s.to);
      expect(covered).toBe(p.bullish);
    }
  });
});
