"use client";

import { useEffect, useRef } from "react";
import {
  useChartStore,
  DEFAULT_CONFIG,
  ALL_INDICATORS_FALSE,
  type Watchlist,
} from "@/lib/store/chart-store";
import {
  loadChartSettings,
  saveChartSettings,
  loadWatchlistItems,
  saveWatchlistItems,
} from "./user-data";
import { useAuth } from "./auth-context";

const DEBOUNCE_MS = 1500;

function activeItems(watchlists: Watchlist[], activeId: string) {
  return watchlists.find((x) => x.id === activeId)?.items ?? [];
}

export function useCloudSync() {
  const { user } = useAuth();
  /** Load *attempted* — guards the one-shot init effect against re-running. */
  const initializedRef = useRef(false);
  /**
   * Load *succeeded* — guards both debounced saves below.
   *
   * These used to share `initializedRef`, which flips synchronously at the
   * top of the init effect: the save effects then ran on the very same
   * sign-in render, saw it already set, and scheduled an upsert of this
   * device's local state 1.5s later. A load slower than that debounce (or one
   * that failed outright) therefore overwrote the cloud row with whatever
   * localStorage happened to hold, before ever seeing what was up there. Same
   * split, and same reasoning, as `usePaperAccountSync`.
   */
  const loadedRef = useRef(false);

  // ── Fields synced to the cloud ───────────────────────────────────────────
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const indicators = useChartStore((s) => s.indicators);
  const hidden = useChartStore((s) => s.hidden);
  const config = useChartStore((s) => s.config);
  const chartColors = useChartStore((s) => s.chartColors);
  const adxStyle = useChartStore((s) => s.adxStyle);
  const squeezeStyle = useChartStore((s) => s.squeezeStyle);
  const bollingerStyle = useChartStore((s) => s.bollingerStyle);
  const vwapStyle = useChartStore((s) => s.vwapStyle);
  const volumeProfile = useChartStore((s) => s.volumeProfile);
  const keyLevels = useChartStore((s) => s.keyLevels);
  const userEMAs = useChartStore((s) => s.userEMAs);
  const chartType = useChartStore((s) => s.chartType);
  const watchlists = useChartStore((s) => s.watchlists);
  const activeWatchlistId = useChartStore((s) => s.activeWatchlistId);

  const setSymbol = useChartStore((s) => s.setSymbol);
  const setTimeframe = useChartStore((s) => s.setTimeframe);

  // ── Carga inicial al hacer sign-in ────────────────────────────────────────
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      const [settings, wl] = await Promise.all([
        loadChartSettings(),
        loadWatchlistItems(),
      ]);

      if (settings) {
        setSymbol(settings.symbol);
        setTimeframe(settings.timeframe);
        // A row written before an indicator existed has no key for it, and an
        // undefined slot would leave `indicators`/`config` incomplete — so
        // every load is merged onto the current defaults, never assigned raw.
        useChartStore.setState({
          indicators: { ...ALL_INDICATORS_FALSE, ...settings.indicators },
          hidden: { ...ALL_INDICATORS_FALSE, ...settings.hidden },
          config: { ...DEFAULT_CONFIG, ...(settings.config ?? {}) },
        });

        // Visual settings: colors, indicator styles, EMAs, chartType
        const vs = settings.visual_settings;
        if (vs) {
          useChartStore.setState({
            ...(vs.chartColors   && { chartColors:   vs.chartColors }),
            ...(vs.adxStyle      && { adxStyle:      vs.adxStyle }),
            ...(vs.squeezeStyle  && { squeezeStyle:  vs.squeezeStyle }),
            ...(vs.bollingerStyle && { bollingerStyle: vs.bollingerStyle }),
            ...(vs.vwapStyle     && { vwapStyle:     vs.vwapStyle }),
            ...(vs.volumeProfile && { volumeProfile: vs.volumeProfile }),
            ...(vs.keyLevels     && { keyLevels:     vs.keyLevels }),
            ...(vs.userEMAs      !== undefined && { userEMAs: vs.userEMAs }),
            ...(vs.chartType     && { chartType:     vs.chartType }),
          });
        }
      }

      if (wl && wl.length > 0) {
        const cloudHasLabels = wl.some((i) => i.type === "label");

        useChartStore.setState((state) => {
          const next = state.watchlists.map((w) => {
            if (w.id !== state.activeWatchlistId) return w;

            if (cloudHasLabels) {
              // Cloud is in the new format → replace, to preserve the cloud's labels
              return { ...w, items: wl };
            }

            // Legacy format (symbols only) → merge, preserving local labels
            const have = new Set(
              w.items.filter((i) => i.type === "symbol").map((i) => i.value),
            );
            const adds = wl
              .filter((i) => i.type === "symbol" && !have.has(i.value))
              .map((i) => ({
                id: Math.random().toString(36).slice(2, 10),
                type: "symbol" as const,
                value: i.value,
              }));
            return adds.length === 0 ? w : { ...w, items: [...w.items, ...adds] };
          });
          return { watchlists: next };
        });
      }
    }

    init()
      .then(() => {
        loadedRef.current = true;
      })
      .catch((err) => {
        // Leave `loadedRef` false so the debounced saves stay gated off for
        // the rest of the session: better to sync nothing than to upsert
        // local state over a cloud row the load never actually read.
        console.error(
          "Failed to load settings/watchlist from Supabase; skipping cloud sync this session",
          err,
        );
      });
  }, [user, setSymbol, setTimeframe]);

  // ── Reset al hacer sign-out ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      initializedRef.current = false;
      loadedRef.current = false;
    }
  }, [user]);

  // ── Debounced settings sync (indicators + visual) ────────────────────────
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(() => {
      saveChartSettings({
        symbol,
        timeframe,
        indicators,
        hidden,
        config,
        visual_settings: {
          chartColors,
          adxStyle,
          squeezeStyle,
          bollingerStyle,
          vwapStyle,
          volumeProfile,
          keyLevels,
          userEMAs,
          chartType,
        },
      });
    }, DEBOUNCE_MS);
    return () => {
      if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    };
  }, [
    user,
    symbol, timeframe, indicators, hidden, config,
    chartColors, adxStyle, squeezeStyle, bollingerStyle, vwapStyle, volumeProfile,
    keyLevels, userEMAs, chartType,
  ]);

  // ── Debounced watchlist sync (full items, with labels) ───────────────────
  const wlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    if (wlTimerRef.current) clearTimeout(wlTimerRef.current);
    const items = activeItems(watchlists, activeWatchlistId);
    wlTimerRef.current = setTimeout(() => {
      saveWatchlistItems(items);
    }, DEBOUNCE_MS);
    return () => {
      if (wlTimerRef.current) clearTimeout(wlTimerRef.current);
    };
  }, [user, watchlists, activeWatchlistId]);
}
