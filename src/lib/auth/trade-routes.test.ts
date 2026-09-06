import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { isSignedTradeRoute } from "./trade-routes";

describe("isSignedTradeRoute", () => {
  it("gates every credential-signing trade route", () => {
    for (const p of [
      "/api/trade/order",
      "/api/trade/orders",
      "/api/trade/positions",
      "/api/trade/balance",
      "/api/trade/sync",
      "/api/trade/leverage",
      "/api/trade/position-mode",
      "/api/trade/trading-stop",
    ]) {
      expect(isSignedTradeRoute(p)).toBe(true);
    }
  });

  it("leaves exchange-info open — public data, no credentials", () => {
    expect(isSignedTradeRoute("/api/trade/exchange-info")).toBe(false);
  });

  it("leaves page routes and the public proxies open to guests", () => {
    for (const p of [
      "/",
      "/login",
      "/auth/callback",
      "/manifest.webmanifest",
      "/sw.js",
      "/api/yahoo",
      "/api/fred",
      "/api/coingecko",
    ]) {
      expect(isSignedTradeRoute(p)).toBe(false);
    }
  });

  it("is not fooled by a trailing slash or by casing", () => {
    expect(isSignedTradeRoute("/api/trade/order/")).toBe(true);
    expect(isSignedTradeRoute("/API/Trade/Order")).toBe(true);
    expect(isSignedTradeRoute("/api/trade")).toBe(true);
    expect(isSignedTradeRoute("/api/trade/")).toBe(true);
  });

  it("does not gate an unrelated path that merely starts with the same text", () => {
    expect(isSignedTradeRoute("/api/trades")).toBe(false);
    expect(isSignedTradeRoute("/api/tradehistory")).toBe(false);
  });
});
