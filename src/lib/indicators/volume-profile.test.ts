import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { volumeProfile, valueAreaBounds, developingPoc, rowCountFor } from "./volume-profile";
import type { Candle } from "@/lib/binance/types";

function bar(
  time: number,
  low: number,
  high: number,
  volume: number,
  up = true,
): Candle {
  return {
    time,
    open: up ? low : high,
    high,
    low,
    close: up ? high : low,
    volume,
    isFinal: true,
  };
}

const OPTS = { rowsLayout: "rows" as const, rowSize: 4, valueAreaPct: 70 };

describe("volumeProfile", () => {
  it("returns null when there is no price range", () => {
    expect(volumeProfile([bar(1, 100, 100, 5)], OPTS)).toBeNull();
    expect(volumeProfile([], OPTS)).toBeNull();
  });

  it("splits a bar's volume across the rows it spans, by overlap", () => {
    // One bar from 100 to 104 over 4 rows of 1 → 25% of the volume per row.
    const res = volumeProfile([bar(1, 100, 104, 100)], OPTS);
    expect(res === null).toBe(false);
    expect(res!.rows).toHaveLength(4);
    for (const r of res!.rows) expect(r.total).toBeCloseTo(25, 6);
    expect(res!.totalVolume).toBeCloseTo(100, 6);
  });

  it("keeps a bar whose range fits one row intact instead of dropping it", () => {
    // Range 100–104 comes from the wide bar; the narrow one sits inside row 0.
    const res = volumeProfile([bar(1, 100, 104, 4), bar(2, 100.1, 100.2, 50)], OPTS);
    expect(res!.rows[0].total).toBeCloseTo(51, 6);
  });

  it("separates up and down volume by candle direction", () => {
    const res = volumeProfile([bar(1, 100, 104, 10, true), bar(2, 100, 104, 30, false)], OPTS);
    for (const r of res!.rows) {
      expect(r.up).toBeCloseTo(2.5, 6);
      expect(r.down).toBeCloseTo(7.5, 6);
    }
  });

  it("puts the POC on the heaviest row", () => {
    const res = volumeProfile(
      [bar(1, 100, 104, 4), bar(2, 103.1, 103.9, 500)],
      OPTS,
    );
    // Rows are [100,101) [101,102) [102,103) [103,104]; the heavy bar is in the last.
    expect(res!.pocIndex).toBe(3);
    expect(res!.pocPrice).toBeCloseTo(103.5, 6);
  });

  it("marks a contiguous value area that contains the POC", () => {
    const res = volumeProfile(
      [bar(1, 100, 104, 4), bar(2, 102.1, 102.9, 200), bar(3, 103.1, 103.9, 150)],
      OPTS,
    );
    const flags = res!.rows.map((r) => r.inValueArea);
    expect(flags[res!.pocIndex]).toBe(true);
    const first = flags.indexOf(true);
    const last = flags.lastIndexOf(true);
    for (let i = first; i <= last; i++) expect(flags[i]).toBe(true);
    expect(res!.vaLow).toBeCloseTo(res!.rows[first].low, 6);
    expect(res!.vaHigh).toBeCloseTo(res!.rows[last].high, 6);
  });
});

describe("valueAreaBounds", () => {
  it("expands towards the heavier pair of rows", () => {
    //            0   1   2    3   4   5
    const totals = [1, 1, 10, 100, 40, 40];
    const { lo, hi } = valueAreaBounds(totals, 3, 70, 192);
    // Above the POC carries 80 against 11 below, so it must expand up first.
    expect(hi).toBe(5);
    expect(lo).toBe(3);
  });

  it("stops at the edges instead of running past the ladder", () => {
    const totals = [5, 5, 5];
    const { lo, hi } = valueAreaBounds(totals, 1, 100, 15);
    expect(lo).toBe(0);
    expect(hi).toBe(2);
  });

  it("covers at least the requested share of volume", () => {
    const totals = [10, 20, 50, 15, 5];
    const total = 100;
    const { lo, hi } = valueAreaBounds(totals, 2, 70, total);
    let acc = 0;
    for (let i = lo; i <= hi; i++) acc += totals[i];
    expect(acc >= 70).toBe(true);
  });
});

describe("rowCountFor", () => {
  it("uses rowSize directly in the rows layout", () => {
    expect(rowCountFor(100, { rowsLayout: "rows", rowSize: 24, valueAreaPct: 70 })).toBe(24);
  });

  it("derives the count from tick size in the ticks layout", () => {
    // 100 wide, 0.5 tick, 10 ticks per row → 20 rows.
    expect(
      rowCountFor(100, { rowsLayout: "ticks", rowSize: 10, tickSize: 0.5, valueAreaPct: 70 }),
    ).toBe(20);
  });

  it("clamps absurd row counts", () => {
    expect(
      rowCountFor(100, { rowsLayout: "ticks", rowSize: 1, tickSize: 0.0001, valueAreaPct: 70 }),
    ).toBe(500);
  });
});

describe("developingPoc", () => {
  it("emits one point per bar", () => {
    const candles = [bar(1, 100, 104, 4), bar(2, 100.1, 100.2, 50), bar(3, 103.1, 103.9, 500)];
    const out = developingPoc(candles, OPTS);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.time)).toEqual([1, 2, 3]);
  });

  it("follows the leading row as volume accumulates", () => {
    const candles = [bar(1, 100, 104, 4), bar(2, 100.1, 100.2, 50), bar(3, 103.1, 103.9, 500)];
    const out = developingPoc(candles, OPTS);
    // After bar 2 the bottom row leads; bar 3 dumps far more into the top row.
    expect(out[1].price).toBeCloseTo(100.5, 6);
    expect(out[2].price).toBeCloseTo(103.5, 6);
  });
});
