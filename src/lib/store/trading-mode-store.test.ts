import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { TRADING_MODE_STORAGE_KEY, useTradingModeStore } from "./trading-mode-store";

beforeEach(() => {
  localStorage.removeItem(TRADING_MODE_STORAGE_KEY);
  useTradingModeStore.setState({ mode: "paper" });
});

describe("trading-mode-store", () => {
  it("defaults to paper mode", () => {
    expect(useTradingModeStore.getState().mode).toBe("paper");
  });

  it("switches to live and back", () => {
    useTradingModeStore.getState().setMode("live");
    expect(useTradingModeStore.getState().mode).toBe("live");
    useTradingModeStore.getState().setMode("paper");
    expect(useTradingModeStore.getState().mode).toBe("paper");
  });

  it("persists the chosen mode to localStorage", () => {
    useTradingModeStore.getState().setMode("live");
    const raw = localStorage.getItem(TRADING_MODE_STORAGE_KEY);
    expect(typeof raw).toBe("string");
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.mode).toBe("live");
  });

  it("rehydrating a garbage persisted mode falls back to paper (adversarial review finding 9)", async () => {
    useTradingModeStore.getState().setMode("live");

    localStorage.setItem(
      TRADING_MODE_STORAGE_KEY,
      JSON.stringify({ state: { mode: "banana" }, version: 0 }),
    );
    await useTradingModeStore.persist.rehydrate();
    expect(useTradingModeStore.getState().mode).toBe("paper");

    localStorage.setItem(TRADING_MODE_STORAGE_KEY, JSON.stringify({ state: {}, version: 0 }));
    await useTradingModeStore.persist.rehydrate();
    expect(useTradingModeStore.getState().mode).toBe("paper");

    localStorage.setItem(TRADING_MODE_STORAGE_KEY, JSON.stringify({ state: { mode: null }, version: 0 }));
    await useTradingModeStore.persist.rehydrate();
    expect(useTradingModeStore.getState().mode).toBe("paper");
  });

  it("still rehydrates a genuine live mode", async () => {
    localStorage.setItem(
      TRADING_MODE_STORAGE_KEY,
      JSON.stringify({ state: { mode: "live" }, version: 0 }),
    );
    await useTradingModeStore.persist.rehydrate();
    expect(useTradingModeStore.getState().mode).toBe("live");
  });
});
