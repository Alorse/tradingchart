"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { localStoragePersist } from "@/lib/store/persist-storage";

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
      storage: localStoragePersist<TradingModeState>(),
      // A corrupted/foreign blob (or any value that isn't literally "live")
      // must rehydrate to `paper`, not whatever `current` happened to hold —
      // this is the one store where "wrong default" means a fresh install
      // could come up armed for real orders instead of failing safe
      // (adversarial review finding 9).
      merge: (persisted, current) => {
        const state = persisted as Partial<TradingModeState> | undefined;
        return { ...current, mode: state?.mode === "live" ? "live" : "paper" };
      },
    },
  ),
);
