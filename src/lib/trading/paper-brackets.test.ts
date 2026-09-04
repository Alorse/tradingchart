import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { bracketEditReason } from "./paper-brackets";

describe("bracketEditReason", () => {
  it("allows a long with no brackets set", () => {
    expect(bracketEditReason("LONG", 100, null, null)).toBe(null);
  });

  it("flags a long's take-profit at or below the mark", () => {
    expect(bracketEditReason("LONG", 100, 100, null) === null).toBe(false);
    expect(bracketEditReason("LONG", 100, 90, null) === null).toBe(false);
    expect(bracketEditReason("LONG", 100, 110, null)).toBe(null);
  });

  it("flags a long's stop-loss at or above the mark", () => {
    expect(bracketEditReason("LONG", 100, null, 100) === null).toBe(false);
    expect(bracketEditReason("LONG", 100, null, 110) === null).toBe(false);
    expect(bracketEditReason("LONG", 100, null, 90)).toBe(null);
  });

  it("mirrors the rule for a short", () => {
    expect(bracketEditReason("SHORT", 100, 110, null) === null).toBe(false);
    expect(bracketEditReason("SHORT", 100, 90, null)).toBe(null);

    expect(bracketEditReason("SHORT", 100, null, 90) === null).toBe(false);
    expect(bracketEditReason("SHORT", 100, null, 110)).toBe(null);
  });

  it("skips validation without a usable mark", () => {
    expect(bracketEditReason("LONG", 0, 90, null)).toBe(null);
    expect(bracketEditReason("LONG", NaN, 90, null)).toBe(null);
  });

  it("checks both legs and reports the first that fails (stop-loss precedence not required, just non-null)", () => {
    const reason = bracketEditReason("LONG", 100, 90, 110);
    expect(reason === null).toBe(false);
  });
});
