import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { hedgePositionIdx, remainingQty } from "./hedge";

describe("hedgePositionIdx", () => {
  it("maps entry orders to the slot they open", () => {
    expect(hedgePositionIdx("BUY", false)).toBe(1);
    expect(hedgePositionIdx("SELL", false)).toBe(2);
  });

  it("maps a reduceOnly order to the position it closes, not its own side", () => {
    // A reduceOnly SELL is the LONG's stop/target — slot 1, not 2.
    expect(hedgePositionIdx("SELL", true)).toBe(1);
    expect(hedgePositionIdx("BUY", true)).toBe(2);
  });
});

describe("remainingQty", () => {
  it("returns the unfilled remainder of a partially-filled order", () => {
    expect(remainingQty(1, 0.4)).toBeCloseTo(0.6, 10);
  });

  it("returns the full size when nothing has filled", () => {
    expect(remainingQty(2.5, 0)).toBe(2.5);
  });

  it("returns zero for a fully-filled order rather than a negative size", () => {
    expect(remainingQty(1, 1)).toBe(0);
    expect(remainingQty(1, 1.2)).toBe(0);
  });

  it("treats a missing executed quantity as nothing filled", () => {
    expect(remainingQty(3, NaN)).toBe(3);
  });
});
