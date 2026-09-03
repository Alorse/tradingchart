import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { tradeGate, symbolInfoExchange } from "./exchange-gate";

describe("tradeGate", () => {
  it("allows a Binance symbol on a Binance account", () => {
    expect(tradeGate("BTCUSDT", "binance").ok).toBe(true);
    expect(tradeGate("BTCUSDT.P", "binance").ok).toBe(true);
  });

  it("allows a BYBIT:-prefixed symbol on a Bybit account", () => {
    expect(tradeGate("BYBIT:SOLUSDT.P", "bybit").ok).toBe(true);
  });

  it("blocks a Bybit chart symbol while the account is Binance", () => {
    // The exact bug this guards: both reduce to cleanSym SOLUSDT, so a
    // symbol-only match would have submitted this to Binance's book.
    const gate = tradeGate("BYBIT:SOLUSDT.P", "binance");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toContain("Bybit");
      expect(gate.reason).toContain("Binance");
    }
  });

  it("blocks a Binance chart symbol while the account is Bybit", () => {
    expect(tradeGate("BTCUSDT.P", "bybit").ok).toBe(false);
  });

  it("blocks symbols from sources that can't take an order at all", () => {
    // Synthetic spread — resolves to `synthetic`, not a venue.
    expect(tradeGate("BTCUSDT-ETHUSDT", "binance").ok).toBe(false);
    expect(tradeGate("BTCUSDT/ETHUSDT", "bybit").ok).toBe(false);
  });

  it("names the offending venue so the block is diagnosable", () => {
    const gate = tradeGate("BTCUSDT-ETHUSDT", "binance");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("synthetic");
  });
});

describe("symbolInfoExchange", () => {
  it("follows the symbol's venue, not the connected account", () => {
    expect(symbolInfoExchange("BYBIT:SOLUSDT.P", "binance")).toBe("bybit");
    expect(symbolInfoExchange("BTCUSDT.P", "bybit")).toBe("binance");
  });

  it("falls back to the account for symbols with no exchange of their own", () => {
    expect(symbolInfoExchange("BTCUSDT-ETHUSDT", "bybit")).toBe("bybit");
    expect(symbolInfoExchange("BTCUSDT-ETHUSDT", "binance")).toBe("binance");
  });
});
