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
  Watchlist,
} from "@/lib/store/chart-store";
import type { Timeframe } from "@/lib/binance/types";
import { rowToWatchlists } from "./watchlists-migrate";
import type { CloudWatchlists, RawWatchlistRow } from "./watchlists-migrate";

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

/**
 * Loads the signed-in user's chart settings.
 *
 * Returns `null` only when there genuinely is no row yet, and *throws* on any
 * other failure — same contract, and same reasoning, as `loadWatchlists`
 * below. `.maybeSingle()` rather than `.single()`: the latter reports "no row"
 * as an error, so discarding that error made a dropped connection (or an RLS
 * rejection) indistinguishable from a fresh account. The caller would read the
 * resulting `null` as "nothing up there yet", leave `loadedRef` set and go on
 * to upsert this device's local settings over a cloud row it never read.
 */
export async function loadChartSettings(): Promise<CloudChartSettings | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_chart_settings")
    .select("symbol, timeframe, indicators, hidden, config, visual_settings")
    .maybeSingle();
  if (error) throw error;
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

// ─── Watchlists ───────────────────────────────────────────────────────────────

/**
 * Loads every named watchlist plus the active one's id.
 *
 * Returns `null` when the row genuinely holds no watchlist data — no row yet,
 * or one whose `lists`/`items`/`symbols` are all empty — and *throws* on any
 * other failure. `.maybeSingle()` rather than `.single()`: the latter reports
 * "no row" as an error indistinguishable from a dropped connection, which
 * would let the caller treat a transient failure as a fresh account and push
 * this device's local lists straight over a real cloud row. Migration 06 is a
 * hard dependency of that select, so an unapplied migration throws here too
 * and disables watchlist sync for the session rather than corrupting anything.
 *
 * All parsing lives in the pure [watchlists-migrate.ts](./watchlists-migrate.ts),
 * including the fold of a pre-migration-06 single list into a "Default" entry.
 */
export async function loadWatchlists(): Promise<CloudWatchlists | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_watchlists")
    .select("lists, active_id, items, symbols")
    .maybeSingle();
  if (error) throw error;
  return rowToWatchlists(data as RawWatchlistRow | null);
}

/**
 * Saves every named watchlist and the active one's id.
 *
 * Writes only the migration-06 columns. The legacy `items`/`symbols` are left
 * frozen at whatever the backfill read: mirroring the active list back into
 * them would leave a stale copy of *one* of N lists that the loader's legacy
 * branch could resurface, silently dropping the rest. Nothing reads them once
 * `lists` is non-empty, which it is from this write onwards.
 */
export async function saveWatchlists(lists: Watchlist[], activeId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_watchlists").upsert(
    {
      user_id: user.id,
      lists,
      active_id: activeId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
