"use client";

import { createClient } from "./client";
import type { IndicatorConfig, IndicatorKey } from "@/lib/store/chart-store";
import type {
  ChartColors,
  AdxStyle,
  SqueezeStyle,
  BollingerStyle,
  VwapStyle,
  VolumeProfileConfig,
  KeyLevelsConfig,
  UserEMA,
  ChartType,
  WatchlistItem,
} from "@/lib/store/chart-store";
import type { Timeframe } from "@/lib/binance/types";

export interface VisualSettings {
  chartColors?: ChartColors;
  adxStyle?: AdxStyle;
  squeezeStyle?: SqueezeStyle;
  bollingerStyle?: BollingerStyle;
  vwapStyle?: VwapStyle;
  volumeProfile?: VolumeProfileConfig;
  keyLevels?: KeyLevelsConfig;
  userEMAs?: UserEMA[];
  chartType?: ChartType;
}

export interface CloudChartSettings {
  symbol: string;
  timeframe: Timeframe;
  indicators: Record<IndicatorKey, boolean>;
  hidden: Record<IndicatorKey, boolean>;
  config: IndicatorConfig;
  visual_settings?: VisualSettings;
}

// ─── Chart Settings ───────────────────────────────────────────────────────────

export async function loadChartSettings(): Promise<CloudChartSettings | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("user_chart_settings")
    .select("symbol, timeframe, indicators, hidden, config, visual_settings")
    .single();
  if (!data) return null;
  return data as CloudChartSettings;
}

export async function saveChartSettings(settings: CloudChartSettings) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_chart_settings").upsert(
    { user_id: user.id, ...settings, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

/** Carga la watchlist activa. Prefiere `items` (con labels) sobre `symbols` (legado). */
export async function loadWatchlistItems(): Promise<WatchlistItem[] | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("user_watchlists")
    .select("items, symbols")
    .single();
  if (!data) return null;

  // Columna nueva: items con labels
  if (Array.isArray(data.items) && data.items.length > 0) {
    return data.items as WatchlistItem[];
  }

  // Fallback legado: solo símbolos como texto
  const syms: string[] = Array.isArray(data.symbols) ? data.symbols : [];
  if (syms.length === 0) return null;
  return syms.map((s) => ({
    id: Math.random().toString(36).slice(2, 10),
    type: "symbol" as const,
    value: s,
  }));
}

/** Guarda la watchlist activa. Persiste tanto `symbols` (legado) como `items` (completo). */
export async function saveWatchlistItems(items: WatchlistItem[]) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const symbols = items.filter((i) => i.type === "symbol").map((i) => i.value);

  // Intentar guardar con la columna `items` (migración 03)
  const { error } = await supabase.from("user_watchlists").upsert(
    { user_id: user.id, symbols, items, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );

  // Si falla (columna items no existe aún), guardar solo symbols como fallback
  if (error) {
    await supabase.from("user_watchlists").upsert(
      { user_id: user.id, symbols, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  }
}

// Mantener para compatibilidad con código legado que pueda existir
export async function loadWatchlist(): Promise<string[] | null> {
  const items = await loadWatchlistItems();
  if (!items) return null;
  return items.filter((i) => i.type === "symbol").map((i) => i.value);
}

export async function saveWatchlist(symbols: string[]) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_watchlists").upsert(
    { user_id: user.id, symbols, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}
