import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { formatDuration, reasonLabel } from "./paper-format";

describe("formatDuration", () => {
  it("shows seconds alone under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(999)).toBe("0s");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("switches to minutes+seconds at the minute boundary", () => {
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(3 * 60_000 + 12_000)).toBe("3m 12s");
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59m 59s");
  });

  it("switches to hours+minutes at the hour boundary", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 00m");
    expect(formatDuration(60 * 60_000 + 5 * 60_000)).toBe("1h 05m");
    expect(formatDuration(23 * 60 * 60_000 + 59 * 60_000)).toBe("23h 59m");
  });

  it("switches to days+hours at the day boundary", () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe("1d 0h");
    expect(formatDuration(2 * 24 * 60 * 60_000 + 4 * 60 * 60_000)).toBe("2d 4h");
  });

  it("rejects negative or non-finite durations", () => {
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
    expect(formatDuration(Infinity)).toBe("—");
  });
});

describe("reasonLabel", () => {
  it("maps every close reason to a human-readable label", () => {
    expect(reasonLabel("MANUAL")).toBe("Manual");
    expect(reasonLabel("TP")).toBe("TP");
    expect(reasonLabel("SL")).toBe("SL");
    expect(reasonLabel("LIQUIDATION")).toBe("Liquidation");
  });
});
