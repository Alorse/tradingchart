"use client";

import { useEffect, useRef } from "react";
import {
  useChartStore,
  DEFAULT_CONFIG,
  ALL_INDICATORS_FALSE,
} from "@/lib/store/chart-store";
import {
  loadChartSettings,
  saveChartSettings,
  loadWatchlists,
  saveWatchlists,
} from "./user-data";
import { useAuth } from "./auth-context";

const DEBOUNCE_MS = 1500;

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
    const userId = user.id;

    async function init() {
      const [settings, wl] = await Promise.all([
        loadChartSettings(),
        loadWatchlists(),
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

      // Watchlists: cloud wins, wholesale. Every named list now lives in the
      // row, so a partial merge into the local active list would be merging
      // two complete pictures of the same thing — the cloud copy is the more
      // recently-written device and simply replaces what this one has. A row
      // predating migration 06 arrives here already folded into a single
      // "Default" list by `rowToWatchlists`, so it takes the same path.
      if (wl) {
        useChartStore.setState({
          watchlists: wl.lists,
          ...(wl.activeId && { activeWatchlistId: wl.activeId }),
        });
      } else {
        // No watchlist data in the cloud at all (first sign-in on this
        // account): seed the row from this device instead of waiting for the
        // user to happen to edit a list.
        const { watchlists: local, activeWatchlistId: localActive } =
          useChartStore.getState();
        saveWatchlists(userId, local, localActive);
      }
    }

    init()
      .then(() => {
        loadedRef.current = true;
      })
      .catch((err) => {
        // Leave `loadedRef` false so the debounced saves stay gated off for
        // the rest of the session: better to sync nothing than to upsert
        // local state over a cloud row the load never actually read. An
        // unapplied migration 06 lands here — `loadWatchlists` selects
        // columns that don't exist yet.
        console.error(
          "Failed to load settings/watchlists from Supabase; skipping cloud sync this session " +
            "(is supabase/migrations/06_watchlists.sql applied?)",
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
      saveChartSettings(user.id, {
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

  // ── Debounced watchlist sync (every named list, not just the active one) ──
  const wlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    if (wlTimerRef.current) clearTimeout(wlTimerRef.current);
    wlTimerRef.current = setTimeout(() => {
      saveWatchlists(user.id, watchlists, activeWatchlistId);
    }, DEBOUNCE_MS);
    return () => {
      if (wlTimerRef.current) clearTimeout(wlTimerRef.current);
    };
  }, [user, watchlists, activeWatchlistId]);
}
