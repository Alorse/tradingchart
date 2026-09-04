import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  defaultPaperOrderForm,
  isPaperOrderReady,
  paperFormToLimitRequest,
  paperFormToMarketRequest,
} from "./paper-order-form";

describe("defaultPaperOrderForm", () => {
  it("starts flat on MARKET/BUY with no brackets", () => {
    const form = defaultPaperOrderForm(10);
    expect(form.type).toBe("MARKET");
    expect(form.side).toBe("BUY");
    expect(form.tpEnabled).toBe(false);
    expect(form.slEnabled).toBe(false);
    expect(form.leverage).toBe(10);
  });
});

describe("isPaperOrderReady", () => {
  it("rejects a missing or zero qty", () => {
    expect(isPaperOrderReady({ ...defaultPaperOrderForm(10), qty: "" })).toBe(false);
    expect(isPaperOrderReady({ ...defaultPaperOrderForm(10), qty: "0" })).toBe(false);
  });

  it("accepts a MARKET order with just a qty", () => {
    expect(isPaperOrderReady({ ...defaultPaperOrderForm(10), qty: "1" })).toBe(true);
  });

  it("requires a positive price for a LIMIT order", () => {
    const base = { ...defaultPaperOrderForm(10), type: "LIMIT" as const, qty: "1" };
    expect(isPaperOrderReady({ ...base, price: "" })).toBe(false);
    expect(isPaperOrderReady({ ...base, price: "0" })).toBe(false);
    expect(isPaperOrderReady({ ...base, price: "100" })).toBe(true);
  });
});

describe("paperFormToMarketRequest / paperFormToLimitRequest", () => {
  it("carries side, qty and leverage through", () => {
    const form = { ...defaultPaperOrderForm(25), side: "SELL" as const, qty: "0.5" };
    const req = paperFormToMarketRequest(form, "BTCUSDT");
    expect(req.symbol).toBe("BTCUSDT");
    expect(req.side).toBe("SELL");
    expect(req.qty).toBe(0.5);
    expect(req.leverage).toBe(25);
  });

  it("nulls out a bracket that is toggled off, even with leftover text", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1", tpEnabled: false, tp: "30000" };
    const req = paperFormToMarketRequest(form, "BTCUSDT");
    expect(req.tp).toBe(null);
  });

  it("nulls out a bracket enabled with a blank or invalid value", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1", slEnabled: true, sl: "" };
    expect(paperFormToMarketRequest(form, "BTCUSDT").sl).toBe(null);
  });

  it("passes through a valid enabled bracket", () => {
    const form = {
      ...defaultPaperOrderForm(10),
      qty: "1",
      tpEnabled: true,
      tp: "31000",
      slEnabled: true,
      sl: "29000",
    };
    const req = paperFormToMarketRequest(form, "BTCUSDT");
    expect(req.tp).toBe(31000);
    expect(req.sl).toBe(29000);
  });

  it("includes the limit price only in the limit request", () => {
    const form = { ...defaultPaperOrderForm(10), type: "LIMIT" as const, qty: "1", price: "27000" };
    const limitReq = paperFormToLimitRequest(form, "ETHUSDT");
    expect(limitReq.price).toBe(27000);
    const marketReq = paperFormToMarketRequest(form, "ETHUSDT") as unknown as Record<string, unknown>;
    expect(marketReq.price).toBe(undefined);
  });
});
