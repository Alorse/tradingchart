import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { fitViewLogicalRange, TV_DEFAULT_BAR_SPACING } from "./fit-view";

describe("TV_DEFAULT_BAR_SPACING", () => {
  it("matches TradingView's measured default density", () => {
    expect(TV_DEFAULT_BAR_SPACING).toBe(6);
  });
});

describe("fitViewLogicalRange", () => {
  it("caps the span at ~236 bars on the reporter's 1416px pane", () => {
    const range = fitViewLogicalRange({
      barCount: 1000,
      chartAreaWidth: 1416,
      rightOffset: 4,
    });
    const span = range ? range.to - range.from : null;
    expect(span).toBe(236);
  });

  it("caps the span at ~347 bars on TradingView's measured 2082px pane", () => {
    const range = fitViewLogicalRange({
      barCount: 1000,
      chartAreaWidth: 2082,
      rightOffset: 10,
    });
    const span = range ? range.to - range.from : null;
    expect(span).toBe(347);
  });

  it("keeps the app's right-offset convention: `to` is lastIndex + rightOffset", () => {
    const range = fitViewLogicalRange({
      barCount: 1000,
      chartAreaWidth: 1416,
      rightOffset: 4,
    });
    expect(range!.to).toBe(999 + 4);
  });

  it("fits a dataset smaller than one screen entirely, leaving empty space on the right", () => {
    const range = fitViewLogicalRange({
      barCount: 50,
      chartAreaWidth: 2082,
      rightOffset: 4,
    });
    const span = range ? range.to - range.from : null;
    // Never fits fewer bars than loaded — the whole dataset is shown.
    expect(span).toBe(50);
    // The right offset still pushes the last bar off the right edge, so
    // there is unused pane space past it (what "empty space on the right" means).
    expect(range?.to).toBe(49 + 4);
  });

  it("returns null for a non-positive bar count instead of throwing", () => {
    expect(fitViewLogicalRange({ barCount: 0, chartAreaWidth: 1416, rightOffset: 4 })).toBe(null);
    expect(fitViewLogicalRange({ barCount: -5, chartAreaWidth: 1416, rightOffset: 4 })).toBe(null);
  });

  it("returns null for a non-positive chart-area width instead of throwing", () => {
    expect(fitViewLogicalRange({ barCount: 1000, chartAreaWidth: 0, rightOffset: 4 })).toBe(null);
    expect(fitViewLogicalRange({ barCount: 1000, chartAreaWidth: -100, rightOffset: 4 })).toBe(null);
  });

  it("returns null for a non-positive bar spacing instead of throwing", () => {
    expect(
      fitViewLogicalRange({ barCount: 1000, chartAreaWidth: 1416, rightOffset: 4, barSpacing: 0 }),
    ).toBe(null);
  });

  it("returns null when the pane is too narrow to fit even one bar", () => {
    expect(
      fitViewLogicalRange({ barCount: 1000, chartAreaWidth: 3, rightOffset: 4, barSpacing: 6 }),
    ).toBe(null);
  });
});
