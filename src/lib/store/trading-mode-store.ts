"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Which order panel drives the Trade tab: `paper` submits to
 * `paper-trading-store` (no credentials, simulated fills), `live` submits to
 * `trading-store` (real exchange, real money). Deliberately its own tiny
 * store rather than a field on either trading store — `paper-trading-store`
 * is not wired to `trading-store` on purpose (see its header comment), and
 * the mode toggle needs to read/write independently of both.
 *
 * Defaults to `paper`: a fresh install must never place a real order before
 * the user has explicitly opted into Live mode.
 */

export type TradingMode = "paper" | "live";

export const TRADING_MODE_STORAGE_KEY = "tv-gratis-trading-mode";

interface TradingModeState {
  mode: TradingMode;
  setMode: (mode: TradingMode) => void;
}

export const useTradingModeStore = create<TradingModeState>()(
  persist(
    (set) => ({
      mode: "paper",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: TRADING_MODE_STORAGE_KEY,
      // The default storage option reads `window.localStorage`, which is
      // undefined in the offline `node --test` environment (no `window`
      // global at all) and silently disables persistence. Going through
      // `globalThis.localStorage` instead is identical in the browser and is
      // what lets the test suite exercise the round trip for real — same
      // reasoning as `paper-trading-store.ts`'s custom storage.
      storage: createJSONStorage(() => globalThis.localStorage),
    },
  ),
);
