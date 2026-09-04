import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { timeToX, fractionalLogicalToX } from "./coords";
import type { Candle } from "@/lib/binance/types";

/**
 * Minimal timeScale stub with the real lightweight-charts semantics that
 * matter here: `logicalToCoordinate` returns 0 for non-integer logicals
 * (see _internal_indexToCoordinate in the library) and maps integers with
 * `width - (deltaFromRight + 0.5) * barSpacing - 1`, while
 * `timeToCoordinate` answers null unless the timestamp is an exact bar time.
 * With width=900, barSpacing=8, baseIndex=999, rightOffset=12:
 *   x(999) = 799, x(1000) = 807 — each further logical index is 8px to the right.
 */
function makeChart(opts?: { width?: number; barSpacing?: number; baseIndex?: number; rightOffset?: number }) {
  const width = opts?.width ?? 900;
  const barSpacing = opts?.barSpacing ?? 8;
  const baseIndex = opts?.baseIndex ?? 999;
  const rightOffset = opts?.rightOffset ?? 12;
  const times: number[] = [];
  for (let i = 0; i <= baseIndex; i++) times.push(1_700_000_000 + i * 14400); // 4h grid
  const indexToCoordinate = (index: number): number | null => {
    if (!Number.isInteger(index)) return 0; // the library's actual behaviour
    const deltaFromRight = baseIndex + rightOffset - index;
    return width - (deltaFromRight + 0.5) * barSpacing - 1;
  };
  return {
    timeScale: () => ({
      timeToCoordinate: (t: number) => (times.includes(t) ? indexToCoordinate(times.indexOf(t)) : null),
      logicalToCoordinate: (l: number) => indexToCoordinate(l),
    }),
  };
}

function candles4h(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: 1_700_000_000 + i * 14400,
    open: 1, high: 1, low: 1, close: 1, volume: 1, isFinal: true,
  }));
}

describe("fractionalLogicalToX", () => {
  it("returns the integer mapping for whole logicals", () => {
    const chart = makeChart();
    expect(fractionalLogicalToX(chart, 999)).toBe(799);
    expect(fractionalLogicalToX(chart, 1000)).toBe(807);
  });

  it("interpolates linearly between the two neighbouring bars", () => {
    const chart = makeChart();
    // halfway between x(999)=799 and x(1000)=807
    expect(fractionalLogicalToX(chart, 999.5)).toBe(803);
    // a quarter of the way
    expect(fractionalLogicalToX(chart, 999.25)).toBe(801);
  });

  it("interpolates for negative fractional logicals (before the first bar)", () => {
    const chart = makeChart();
    // x(-2)=-7209, x(-1)=-7201 → halfway is -7205
    expect(fractionalLogicalToX(chart, -1.5)).toBe(-7205);
  });

  it("returns null when the underlying mapping is unavailable", () => {
    const chart = {
      timeScale: () => ({
        timeToCoordinate: () => null,
        logicalToCoordinate: () => null,
      }),
    };
    expect(fractionalLogicalToX(chart, 5.5)).toBeNull();
  });

  it("returns null for non-finite logicals", () => {
    expect(fractionalLogicalToX(makeChart(), Number.NaN)).toBeNull();
    expect(fractionalLogicalToX(makeChart(), Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("timeToX (fractional anchors off the bar grid)", () => {
  // The regression: a drawing anchored on the 1h grid, viewed on a 4h chart.
  // Before the fix, timeToX produced fractional logicals that the raw
  // logicalToCoordinate() turned into 0 — collapsing the drawing onto the
  // left edge (the "position drawing disappears on timeframe change" bug).
  const candles = candles4h(1000);
  const lastTime = candles[candles.length - 1].time; // logical 999 → x=799

  it("maps an on-grid future timestamp exactly one bar ahead", () => {
    expect(timeToX(makeChart(), lastTime + 14400, candles, 14400)).toBe(807);
  });

  it("interpolates a 1h-offset anchor on a 4h chart instead of collapsing to 0", () => {
    // halfway between x(last)=799 and x(last+1)=807 — and crucially NOT 0,
    // which is what the raw logicalToCoordinate() returned before the fix.
    expect(timeToX(makeChart(), lastTime + 7200, candles, 14400)).toBe(803);
  });

  it("interpolates off-grid anchors that fall inside the candle range", () => {
    const tInside = 1_700_000_000 + 43200 + 7200; // 3.5 bars into a 4h chart
    // logical 3.5 → halfway between x(3) and x(4): -7169 + 4
    expect(timeToX(makeChart(), tInside, candles, 14400)).toBe(-7165);
  });

  it("interpolates anchors before the first candle", () => {
    const t = 1_700_000_000 - 7200; // half a bar before bar 0 on a 4h chart
    // logical -0.5 → halfway between x(-1)=-7201 and x(0)=-7193: -7197
    expect(timeToX(makeChart(), t, candles, 14400)).toBe(-7197);
  });

  it("returns null when there are no candles and no direct mapping", () => {
    expect(timeToX(makeChart(), lastTime + 7200, [], 14400)).toBeNull();
  });
});
