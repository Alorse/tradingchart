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
  const initializedRef = useRef(false);

  // ── Campos que se sincronizan a la nube ──────────────────────────────────
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

        // Ajustes visuales: colores, estilos de indicadores, EMAs, chartType
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
              // Nube en formato nuevo → reemplazar para preservar labels de la nube
              return { ...w, items: wl };
            }

            // Formato legado (solo símbolos) → merge preservando labels locales
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

    init();
  }, [user, setSymbol, setTimeframe]);

  // ── Reset al hacer sign-out ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      initializedRef.current = false;
    }
  }, [user]);

  // ── Sync debounced de ajustes (indicadores + visual) ─────────────────────
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !initializedRef.current) return;
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

  // ── Sync debounced de watchlist (items completos con labels) ─────────────
  const wlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !initializedRef.current) return;
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
