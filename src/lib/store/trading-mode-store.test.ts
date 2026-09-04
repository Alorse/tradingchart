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
});
