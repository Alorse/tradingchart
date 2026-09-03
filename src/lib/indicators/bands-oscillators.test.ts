import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { atr, bollingerBands, cci, mfi, stochRsi, vwap, williamsR } from "./index";
import type { Candle } from "@/lib/binance/types";

/** Flat candles (o=h=l=c) — enough for the close-only studies. */
function candles(closes: number[], volume = 1): Candle[] {
  return closes.map((c, i) => ({
    time: i * 60,
    open: c,
    high: c,
    low: c,
    close: c,
    volume,
    isFinal: true,
  }));
}

function ohlc(
  rows: Array<{ o: number; h: number; l: number; c: number; v?: number; t?: number }>,
): Candle[] {
  return rows.map((r, i) => ({
    time: r.t ?? i * 60,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v ?? 1,
    isFinal: true,
  }));
}

describe("bollingerBands", () => {
  it("collapses to the basis when price is flat", () => {
    const out = bollingerBands(candles([10, 10, 10, 10, 10]), 3, 2);
    expect(out).toHaveLength(3);
    for (const p of out) {
      expect(p.mid).toBeCloseTo(10, 9);
      expect(p.upper).toBeCloseTo(10, 9);
      expect(p.lower).toBeCloseTo(10, 9);
    }
  });

  it("uses the population stdev, matching Pine's ta.stdev", () => {
    // closes 1,2,3 → mean 2, population stdev sqrt(2/3) ≈ 0.8165
    const out = bollingerBands(candles([1, 2, 3]), 3, 2);
    expect(out).toHaveLength(1);
    expect(out[0].mid).toBeCloseTo(2, 9);
    expect(out[0].upper).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 9);
    expect(out[0].lower).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3), 9);
  });

  it("keeps the bands symmetric around an EMA basis too", () => {
    const out = bollingerBands(candles([1, 2, 3, 4, 5]), 3, 2, "EMA");
    for (const p of out) {
      expect(p.upper - p.mid).toBeCloseTo(p.mid - p.lower, 9);
    }
  });

  it("returns empty when there are fewer candles than the period", () => {
    expect(bollingerBands(candles([1, 2]), 3)).toEqual([]);
  });
});

describe("vwap", () => {
  const DAY = 86400;

  it("weights by volume rather than averaging closes", () => {
    const out = vwap(
      ohlc([
        { o: 10, h: 10, l: 10, c: 10, v: 1 },
        { o: 20, h: 20, l: 20, c: 20, v: 3 },
      ]),
      "session",
      1,
    );
    // (10*1 + 20*3) / 4 = 17.5 — a plain mean would say 15.
    expect(out[1].mid).toBeCloseTo(17.5, 9);
  });

  it("resets the accumulation on a new UTC day", () => {
    const out = vwap(
      ohlc([
        { o: 10, h: 10, l: 10, c: 10, v: 10, t: 0 },
        { o: 10, h: 10, l: 10, c: 10, v: 10, t: 3600 },
        { o: 50, h: 50, l: 50, c: 50, v: 1, t: DAY },
      ]),
      "session",
    );
    // The third bar opens a new session, so it must be its own VWAP, not 13.6.
    expect(out[2].mid).toBeCloseTo(50, 9);
  });

  it("keeps a single anchor when the reset is weekly", () => {
    // 1970-01-01 was a Thursday, so day 0 and day 1 share the same week.
    const out = vwap(
      ohlc([
        { o: 10, h: 10, l: 10, c: 10, v: 10, t: 0 },
        { o: 50, h: 50, l: 50, c: 50, v: 10, t: DAY },
      ]),
      "week",
    );
    expect(out[1].mid).toBeCloseTo(30, 9);
  });

  it("has no band spread while price does not move", () => {
    const out = vwap(candles([10, 10, 10]), "session", 2);
    for (const p of out) {
      expect(p.upper).toBeCloseTo(10, 6);
      expect(p.lower).toBeCloseTo(10, 6);
    }
  });
});

describe("stochRsi", () => {
  it("pins to 100 when RSI sits at the top of its own window", () => {
    // Fall for 40 bars, then rise for 40 — the RSI of the last bars is the
    // highest in the stochastic window, so %K saturates.
    const closes = [
      ...Array.from({ length: 40 }, (_, i) => 200 - i),
      ...Array.from({ length: 40 }, (_, i) => 160 + i),
    ];
    const out = stochRsi(candles(closes), 14, 14, 3, 3);
    expect(out.length > 0).toBe(true);
    expect(out.at(-1)!.k).toBeCloseTo(100, 6);
    expect(out.at(-1)!.d).toBeCloseTo(100, 6);
  });

  it("reads 0 on a monotonic ramp, where RSI is constant and the range degenerates", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const out = stochRsi(candles(closes), 14, 14, 3, 3);
    expect(out.at(-1)!.k).toBeCloseTo(0, 6);
  });

  it("stays inside 0..100", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    for (const p of stochRsi(candles(closes))) {
      expect(p.k >= 0 && p.k <= 100).toBe(true);
      expect(p.d >= 0 && p.d <= 100).toBe(true);
    }
  });
});

describe("williamsR", () => {
  it("is 0 when the close sits at the window high", () => {
    const out = williamsR(ohlc([
      { o: 1, h: 2, l: 1, c: 1 },
      { o: 1, h: 3, l: 1, c: 3 },
    ]), 2);
    expect(out.at(-1)!.value).toBeCloseTo(0, 9);
  });

  it("is -100 when the close sits at the window low", () => {
    const out = williamsR(ohlc([
      { o: 1, h: 5, l: 1, c: 5 },
      { o: 5, h: 5, l: 1, c: 1 },
    ]), 2);
    expect(out.at(-1)!.value).toBeCloseTo(-100, 9);
  });
});

describe("atr", () => {
  it("equals the constant true range on a steady series", () => {
    const rows = Array.from({ length: 20 }, () => ({ o: 10, h: 12, l: 10, c: 10 }));
    const out = atr(ohlc(rows), 14);
    expect(out.at(-1)!.value).toBeCloseTo(2, 9);
  });

  it("starts at bar period-1, aligned to the candle array", () => {
    const rows = Array.from({ length: 20 }, () => ({ o: 10, h: 12, l: 10, c: 10 }));
    const cs = ohlc(rows);
    const out = atr(cs, 14);
    expect(out[0].time).toBe(cs[13].time);
  });
});

describe("cci", () => {
  it("is 0 when the typical price never leaves its mean", () => {
    const out = cci(candles([5, 5, 5, 5, 5]), 3);
    for (const p of out) expect(p.value).toBeCloseTo(0, 9);
  });

  it("goes strongly positive on a breakout above the mean", () => {
    const out = cci(candles([10, 10, 10, 10, 20]), 5);
    expect(out.at(-1)!.value).toBeGreaterThan(100);
  });
});

describe("mfi", () => {
  it("is 100 when every bar's typical price rises", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = mfi(candles(closes, 10), 14);
    expect(out.at(-1)!.value).toBeCloseTo(100, 9);
  });

  it("is 0 when every bar's typical price falls", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
    const out = mfi(candles(closes, 10), 14);
    expect(out.at(-1)!.value).toBeCloseTo(0, 9);
  });

  it("returns empty when there are not enough candles", () => {
    expect(mfi(candles([1, 2, 3]), 14)).toEqual([]);
  });
});
