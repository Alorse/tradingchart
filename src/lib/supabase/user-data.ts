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

/** Loads the active watchlist. Prefers `items` (with labels) over `symbols` (legacy). */
export async function loadWatchlistItems(): Promise<WatchlistItem[] | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("user_watchlists")
    .select("items, symbols")
    .single();
  if (!data) return null;

  // New column: items with labels
  if (Array.isArray(data.items) && data.items.length > 0) {
    return data.items as WatchlistItem[];
  }

  // Legacy fallback: plain symbol strings only
  const syms: string[] = Array.isArray(data.symbols) ? data.symbols : [];
  if (syms.length === 0) return null;
  return syms.map((s) => ({
    id: Math.random().toString(36).slice(2, 10),
    type: "symbol" as const,
    value: s,
  }));
}

/** Saves the active watchlist. Persists both `symbols` (legacy) and `items` (full). */
export async function saveWatchlistItems(items: WatchlistItem[]) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const symbols = items.filter((i) => i.type === "symbol").map((i) => i.value);

  // Try saving with the `items` column (migration 03)
  const { error } = await supabase.from("user_watchlists").upsert(
    { user_id: user.id, symbols, items, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );

  // If that fails (the items column doesn't exist yet), fall back to symbols only
  if (error) {
    await supabase.from("user_watchlists").upsert(
      { user_id: user.id, symbols, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  }
}

// Kept for compatibility with any legacy code that may still exist
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
