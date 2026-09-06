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

// Every save below takes the signed-in `userId` from the caller rather than
// calling `supabase.auth.getUser()` for it. `getUser()` is not a local read —
// it round-trips to the auth server on every call — so fetching it here made
// each debounced save two sequential requests instead of one, for an id the
// calling hook already holds via `useAuth()`. RLS (`auth.uid() = user_id`) is
// what actually authorizes the row; the extra hop bought nothing. Same reason
// `src/middleware.ts` prefers `getClaims()` over `getUser()`.

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

/**
 * Upserts the signed-in user's chart settings.
 *
 * Rejects on a failed upsert instead of swallowing the error, so a cloud save
 * that never landed is distinguishable from one that did (same contract as
 * `savePaperAccount`) — callers that fire-and-forget must attach a `.catch`.
 */
export async function saveChartSettings(
  userId: string,
  settings: CloudChartSettings,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("user_chart_settings").upsert(
    { user_id: userId, ...settings, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw error;
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
 * and disables watchlist sync for the session rather than corrupting anything
 * — and, since this is the only place that knows which columns the read needs,
 * it is where that diagnosis gets attached to the error.
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
  if (error) {
    throw new Error(
      `Failed to load watchlists (is supabase/migrations/06_watchlists.sql applied?): ${error.message}`,
      { cause: error },
    );
  }
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
 *
 * Rejects on a failed upsert rather than swallowing the error — the sync
 * hook's one-shot seed write awaits this to decide whether the row it is about
 * to keep syncing against actually exists, and the debounced saves attach a
 * `.catch` so a cloud write that never landed is at least visible.
 */
export async function saveWatchlists(
  userId: string,
  lists: Watchlist[],
  activeId: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("user_watchlists").upsert(
    {
      user_id: userId,
      lists,
      active_id: activeId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}
