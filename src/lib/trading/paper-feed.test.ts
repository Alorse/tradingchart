import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { paperFeedSource } from "./paper-feed";

describe("paperFeedSource", () => {
  it("uses Binance for a plain ticker", () => {
    expect(paperFeedSource("BTCUSDT")).toBe("binance");
    expect(paperFeedSource("BTCUSDT.P")).toBe("binance");
  });

  it("uses Bybit for a BYBIT:-prefixed ticker", () => {
    expect(paperFeedSource("BYBIT:SOLUSDT.P")).toBe("bybit");
  });

  it("has no feed for a synthetic expression", () => {
    expect(paperFeedSource("BTCUSDT-ETHUSDT")).toBe(null);
  });

  it("has no feed for a catalog stock (Yahoo-sourced)", () => {
    expect(paperFeedSource("AAPL")).toBe(null);
  });
});
