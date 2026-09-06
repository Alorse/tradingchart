"use client";

import { useEffect, useState } from "react";
import { getDailyOpens } from "@/lib/watchlist/daily-open";

/** How often we re-ask for the daily opens. `getDailyOpens` caches by UTC date,
 *  so a tick costs nothing once every symbol is cached — it exists to notice the
 *  midnight rollover and to retry symbols whose fetch failed. */
const REFRESH_MS = 60_000;

function sameOpens(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * UTC-midnight open per symbol — the baseline for the watchlist "Chg" column.
 * Shared by the desktop and mobile watchlists, the same way `useBatchedTicks`
 * is; the two are mounted alternately, so this stays per-component rather than
 * hoisted into `providers.tsx`.
 *
 * The result is only re-published when a value actually changes, so the once-a-
 * day refresh doesn't invalidate the caller's sort memo 1,440 times a day.
 */
export function useDailyOpens(symbols: string[]): Record<string, number> {
  const [opens, setOpens] = useState<Record<string, number>>({});
  // Identity of the symbol set, and the effect's only dependency. Rebuilding
  // the list from it keeps the effect off the array's changing reference.
  const key = symbols.join(",");

  useEffect(() => {
    if (key === "") return;
    const list = key.split(",");
    let cancelled = false;
    function load() {
      getDailyOpens(list).then((next) => {
        if (!cancelled) setOpens((prev) => (sameOpens(prev, next) ? prev : next));
      });
    }
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [key]);

  return opens;
}
