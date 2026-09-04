import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { bracketEditReason } from "./paper-brackets";

describe("bracketEditReason", () => {
  it("allows a long with no brackets set", () => {
    expect(bracketEditReason("LONG", 100, null, null)).toBe(null);
  });

  it("flags a long's take-profit at or below the mark", () => {
    expect(bracketEditReason("LONG", 100, 100, null)).toBe(
      "Take-profit must be above the current mark",
    );
    expect(bracketEditReason("LONG", 100, 90, null)).toBe(
      "Take-profit must be above the current mark",
    );
    expect(bracketEditReason("LONG", 100, 110, null)).toBe(null);
  });

  it("flags a long's stop-loss at or above the mark", () => {
    expect(bracketEditReason("LONG", 100, null, 100)).toBe(
      "Stop-loss must be below the current mark",
    );
    expect(bracketEditReason("LONG", 100, null, 110)).toBe(
      "Stop-loss must be below the current mark",
    );
    expect(bracketEditReason("LONG", 100, null, 90)).toBe(null);
  });

  it("mirrors the rule for a short", () => {
    expect(bracketEditReason("SHORT", 100, 110, null)).toBe(
      "Take-profit must be below the current mark",
    );
    expect(bracketEditReason("SHORT", 100, 90, null)).toBe(null);

    expect(bracketEditReason("SHORT", 100, null, 90)).toBe(
      "Stop-loss must be above the current mark",
    );
    expect(bracketEditReason("SHORT", 100, null, 110)).toBe(null);
  });

  it("skips validation without a usable mark", () => {
    expect(bracketEditReason("LONG", 0, 90, null)).toBe(null);
    expect(bracketEditReason("LONG", NaN, 90, null)).toBe(null);
  });

  it("checks both legs and reports the take-profit failure first", () => {
    expect(bracketEditReason("LONG", 100, 90, 110)).toBe(
      "Take-profit must be above the current mark",
    );
  });
});
