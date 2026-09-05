import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { describePaperEvent, formatDuration, reasonLabel } from "./paper-format";
import type { PaperEvent, PaperTrade } from "./paper-engine";

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

const TRADE: PaperTrade = {
  id: "t", symbol: "BTCUSDT", side: "LONG", qty: 1, entryPrice: 20_000, exitPrice: 21_000,
  leverage: 10, margin: 2_000, fees: 10, grossPnl: 1_000, realizedPnl: 990, roi: 0.495,
  reason: "TP", openedAt: 0, closedAt: 1, durationMs: 1,
};

describe("describePaperEvent", () => {
  it("describes a fill", () => {
    const e: PaperEvent = { type: "fill", orderId: null, symbol: "BTCUSDT", side: "BUY", qty: 1, price: 20_000, fee: 10 };
    expect(describePaperEvent(e)).toBe("Bought 1 BTCUSDT @ 20,000");
  });

  it("describes a profitable close with a sign and the reason", () => {
    const e: PaperEvent = { type: "close", symbol: "BTCUSDT", reason: "TP", trade: TRADE };
    expect(describePaperEvent(e)).toBe("Closed 1 BTCUSDT (TP) — +990.00 USDT");
  });

  it("describes a losing close without a leading plus", () => {
    const losing: PaperTrade = { ...TRADE, realizedPnl: -50, reason: "SL" };
    const e: PaperEvent = { type: "close", symbol: "BTCUSDT", reason: "SL", trade: losing };
    expect(describePaperEvent(e)).toBe("Closed 1 BTCUSDT (SL) — -50.00 USDT");
  });

  it("describes a cancel", () => {
    const e: PaperEvent = { type: "cancel", orderId: "o1", symbol: "BTCUSDT" };
    expect(describePaperEvent(e)).toBe("Canceled order on BTCUSDT");
  });

  it("describes a reject with its message", () => {
    const e: PaperEvent = { type: "reject", symbol: "BTCUSDT", message: "Insufficient paper balance" };
    expect(describePaperEvent(e)).toBe("BTCUSDT: Insufficient paper balance");
  });
});
