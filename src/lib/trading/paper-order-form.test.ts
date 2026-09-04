import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  defaultPaperOrderForm,
  invalidBracketReason,
  isPaperOrderReady,
  paperFormToLimitRequest,
  paperFormToMarketRequest,
} from "./paper-order-form";
import { createAccount, fillMarketOrder } from "./paper-engine";

const NOW = 1_700_000_000_000;

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
  it("carries side, qty and leverage through (leverage only applies to perps, see below)", () => {
    const form = { ...defaultPaperOrderForm(25), side: "SELL" as const, qty: "0.5" };
    const req = paperFormToMarketRequest(form, "BTCUSDT.P");
    expect(req.symbol).toBe("BTCUSDT.P");
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

  it("canonicalizes a decorated symbol by stripping the venue prefix only, keeping .P (holistic review finding 4)", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1" };
    expect(paperFormToMarketRequest(form, "BTCUSDT").symbol).toBe("BTCUSDT");
    expect(paperFormToMarketRequest(form, "BTCUSDT.P").symbol).toBe("BTCUSDT.P");
    expect(paperFormToMarketRequest(form, "BYBIT:SOLUSDT.P").symbol).toBe("SOLUSDT.P");
    expect(paperFormToLimitRequest({ ...form, type: "LIMIT" as const, price: "100" }, "BYBIT:SOLUSDT.P").symbol).toBe(
      "SOLUSDT.P",
    );
  });

  it("gives spot and perp of one ticker distinct keys, so the engine can't net them (holistic review finding 4)", () => {
    // Sized to fit the seed balance: the spot leg is forced to 1x, so its
    // margin is the full notional.
    const form = { ...defaultPaperOrderForm(10), qty: "0.1" };
    const spot = paperFormToMarketRequest(form, "BTCUSDT");
    const perp = paperFormToMarketRequest({ ...form, side: "SELL" as const }, "BTCUSDT.P");
    expect(spot.symbol === perp.symbol).toBe(false);

    // Netting is by `symbol` string equality inside the engine, so distinct
    // keys are exactly what keeps these two fills from closing each other.
    let account = fillMarketOrder(createAccount(), spot, 20_000, NOW).account;
    account = fillMarketOrder(account, perp, 20_000, NOW + 1).account;
    expect(account.positions).toHaveLength(2);
    expect(account.history).toHaveLength(0);
  });

  it("forces leverage to 1 for a non-perp (spot) symbol regardless of the form's leverage (adversarial review finding 8)", () => {
    const form = { ...defaultPaperOrderForm(25), qty: "1" };
    expect(paperFormToMarketRequest(form, "BTCUSDT").leverage).toBe(1);
    expect(paperFormToMarketRequest(form, "BYBIT:SOLUSDT").leverage).toBe(1);
  });

  it("passes the form's leverage through for a perp symbol", () => {
    const form = { ...defaultPaperOrderForm(25), qty: "1" };
    expect(paperFormToMarketRequest(form, "BTCUSDT.P").leverage).toBe(25);
    expect(paperFormToMarketRequest(form, "BYBIT:SOLUSDT.P").leverage).toBe(25);
  });
});

describe("invalidBracketReason", () => {
  it("allows a long with no brackets set", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1" };
    expect(invalidBracketReason(form, 100)).toBe(null);
  });

  it("flags a long's take-profit at or below the reference price", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1", tpEnabled: true, tp: "100" };
    expect(invalidBracketReason(form, 100) === null).toBe(false);
    expect(invalidBracketReason({ ...form, tp: "90" }, 100) === null).toBe(false);
    expect(invalidBracketReason({ ...form, tp: "110" }, 100)).toBe(null);
  });

  it("flags a long's stop-loss at or above the reference price", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1", slEnabled: true, sl: "100" };
    expect(invalidBracketReason(form, 100) === null).toBe(false);
    expect(invalidBracketReason({ ...form, sl: "110" }, 100) === null).toBe(false);
    expect(invalidBracketReason({ ...form, sl: "90" }, 100)).toBe(null);
  });

  it("mirrors the rule for a short", () => {
    const form = { ...defaultPaperOrderForm(10), side: "SELL" as const, qty: "1", tpEnabled: true, tp: "110" };
    expect(invalidBracketReason(form, 100) === null).toBe(false);
    expect(invalidBracketReason({ ...form, tp: "90" }, 100)).toBe(null);

    const slForm = { ...defaultPaperOrderForm(10), side: "SELL" as const, qty: "1", slEnabled: true, sl: "90" };
    expect(invalidBracketReason(slForm, 100) === null).toBe(false);
    expect(invalidBracketReason({ ...slForm, sl: "110" }, 100)).toBe(null);
  });

  it("skips validation without a usable reference price", () => {
    const form = { ...defaultPaperOrderForm(10), qty: "1", tpEnabled: true, tp: "90" };
    expect(invalidBracketReason(form, 0)).toBe(null);
    expect(invalidBracketReason(form, NaN)).toBe(null);
  });
});
