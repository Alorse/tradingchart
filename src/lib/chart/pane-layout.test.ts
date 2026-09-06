import { test, describe } from "node:test";
import { expect } from "@/test-utils/expect";
import { normalizeRatios, adaptRatios } from "@/lib/chart/pane-layout";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("normalizeRatios", () => {
  test("scales pixel heights to a unit sum", () => {
    const r = normalizeRatios([420, 180])!;
    expect(r[0]).toBeCloseTo(0.7, 5);
    expect(r[1]).toBeCloseTo(0.3, 5);
    expect(sum(r)).toBeCloseTo(1, 10);
  });

  test("is viewport-independent", () => {
    const small = normalizeRatios([210, 90])!;
    const large = normalizeRatios([840, 360])!;
    expect(small[0]).toBeCloseTo(large[0], 10);
  });

  test("rejects a collapsed or invalid pane", () => {
    expect(normalizeRatios([400, 0])).toBe(null);
    expect(normalizeRatios([400, -10])).toBe(null);
    expect(normalizeRatios([400, NaN])).toBe(null);
    expect(normalizeRatios([])).toBe(null);
  });
});

describe("adaptRatios", () => {
  test("restores an exact match — the same-indicators, new-symbol case", () => {
    const saved = [0.7, 0.3];
    expect(adaptRatios(saved, 2)).toEqual(saved);
  });

  test("re-normalizes a saved list that drifted off 1", () => {
    const r = adaptRatios([7, 3], 2)!;
    expect(r[0]).toBeCloseTo(0.7, 10);
  });

  test("keeps the main pane and splits the rest when a sub-pane is added", () => {
    const r = adaptRatios([0.7, 0.3], 3)!;
    expect(r[0]).toBeCloseTo(0.7, 10);
    expect(r[1]).toBeCloseTo(0.15, 10);
    expect(r[2]).toBeCloseTo(0.15, 10);
    expect(sum(r)).toBeCloseTo(1, 10);
  });

  test("keeps the main pane when a sub-pane is removed", () => {
    const r = adaptRatios([0.6, 0.2, 0.2], 2)!;
    expect(r[0]).toBeCloseTo(0.6, 10);
    expect(r[1]).toBeCloseTo(0.4, 10);
  });

  test("collapses to a single full-height pane", () => {
    expect(adaptRatios([0.7, 0.3], 1)).toEqual([1]);
  });

  test("never leaves a sub-pane at zero height", () => {
    const r = adaptRatios([1], 3)!;
    expect(r.every((x) => x > 0)).toBe(true);
    expect(sum(r)).toBeCloseTo(1, 10);
  });

  test("returns null when there is nothing saved or no panes", () => {
    expect(adaptRatios(null, 2)).toBe(null);
    expect(adaptRatios([0.7, 0.3], 0)).toBe(null);
    expect(adaptRatios([0, 0], 2)).toBe(null);
  });
});
