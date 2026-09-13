"use client";

import { useMemo, useRef } from "react";
import { dailyChange } from "@/lib/watchlist/daily-open";
import { sortWatchlistItems, type WatchRow, type WatchSort } from "@/lib/watchlist/sort";

/** A live watchlist row as the tick batcher writes it. */
interface TickRow {
  symbol: string;
  price: number;
  pct: number;
}

interface ItemLike {
  id: string;
  type: "symbol" | "label";
  value: string;
}

/**
 * Sort input: "change" sorts on the daily pct (price vs UTC-midnight open), not
 * `rows`' own rolling-24h field, which is no longer displayed. A symbol whose
 * open hasn't loaded leaves pct undefined so the sorter ranks it as unknown,
 * while its price still sorts normally.
 */
function snapshotRows(
  rows: Record<string, TickRow>,
  dailyOpens: Record<string, number>,
): Record<string, WatchRow> {
  const out: Record<string, WatchRow> = {};
  for (const [sym, r] of Object.entries(rows)) {
    out[sym] = { price: r.price, pct: dailyChange(r.price, dailyOpens[sym])?.pct };
  }
  return out;
}

/**
 * Fingerprint of everything that should trigger a RE-SORT — deliberately
 * excluding live prices, so a tick never reorders the list. That means: the
 * sort settings, the set/order of visible items (symbol added or removed,
 * watchlist switched, section collapsed), and — for "change" only — the daily
 * opens, so a symbol whose UTC-midnight open was still loading when the column
 * was clicked settles into its correct place once it arrives.
 *
 * Exported for unit tests; `useWatchlistSort` is the only production caller.
 */
export function watchlistSortFingerprint(
  visibleItems: ItemLike[],
  dailyOpens: Record<string, number>,
  sort: WatchSort,
): string {
  const opensKey =
    sort.key === "change"
      ? Object.entries(dailyOpens)
          .map(([k, v]) => `${k}=${v}`)
          .sort()
          .join(",")
      : "";
  return [sort.key, sort.dir, opensKey, visibleItems.map((i) => i.id).join(",")].join("\u0000");
}

/**
 * Display order for a watchlist. Sorting by Price/Chg is a **one-time snapshot**
 * of the values at the moment the column was clicked, not a live re-sort: prices
 * keep updating in place (the caller reads `rows`/`dailyOpens` at render time),
 * but the row order only changes when a structural input does — otherwise every
 * 150ms tick flush would shuffle the list under the cursor.
 *
 * Shared by the desktop `Watchlist` and mobile `WatchlistScreen`, the same way
 * `useDailyOpens` / `useBatchedTicks` are, so the two can't drift.
 */
export function useWatchlistSort<T extends ItemLike>(
  visibleItems: T[],
  rows: Record<string, TickRow>,
  dailyOpens: Record<string, number>,
  sort: WatchSort,
): T[] {
  const key = watchlistSortFingerprint(visibleItems, dailyOpens, sort);

  // The values the current order was sorted on, captured at the last structural
  // change. Writing and reading the ref in the same render pass is the whole
  // point here — it is a cache keyed on `key`, not hidden state: the same `key`
  // always yields the same order, and a `useEffect` would instead sort one frame
  // late and flicker the list. `react-hooks/refs` can't see that invariant.
  /* eslint-disable react-hooks/refs */
  const frozen = useRef<{ key: string; rows: Record<string, WatchRow> } | null>(null);
  if (frozen.current?.key !== key) {
    frozen.current = { key, rows: snapshotRows(rows, dailyOpens) };
  }
  const sortValues = frozen.current.rows;

  // Keyed on `key` rather than on `rows`, so the returned array keeps a stable
  // identity between ticks. `sort` and `sortValues` are intentionally not deps:
  // both are already fully described by `key`, while `sort`'s object identity is
  // not guaranteed to be.
  return useMemo(() => {
    if (sort.key === "manual") return visibleItems;
    return sortWatchlistItems(visibleItems, sortValues, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, key]);
  /* eslint-enable react-hooks/refs */
}
