"use client";

import { Star } from "lucide-react";
import { useChartStore } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import type { Timeframe } from "@/lib/binance/types";
import { cn } from "@/lib/utils";
import { MobileSheet } from "./MobileSheet";

/**
 * Mobile timeframe picker — replaces desktop's `TimeframeSelector` dropdown,
 * which is a hand-positioned `absolute` popover (not the shared `DropdownMenu`
 * primitive) that would clip against a narrow viewport, and whose per-row
 * favorite star is hover-revealed for non-favorited rows. A fullscreen sheet
 * sidesteps both: no positioning to clip, and the star is always visible.
 *
 * TODO: row density here still isn't touch-tuned pass-for-pass with the rest
 * of the mobile shell (e.g. hit-area/spacing) — deferred to a later pass.
 */

const TF_FULL: Record<Timeframe, string> = {
  "1m": "1 minute", "3m": "3 minutes", "5m": "5 minutes",
  "15m": "15 minutes", "30m": "30 minutes",
  "1h": "1 hour", "2h": "2 hours", "4h": "4 hours",
  "6h": "6 hours", "8h": "8 hours", "12h": "12 hours",
  "1d": "1 day", "3d": "3 days", "1w": "1 week", "1M": "1 month",
};

const TF_GROUPS: { label: string; values: Timeframe[] }[] = [
  { label: "Minutes", values: ["1m", "3m", "5m", "15m", "30m"] },
  { label: "Hours",   values: ["1h", "2h", "4h", "6h", "8h", "12h"] },
  { label: "Days+",   values: ["1d", "3d", "1w", "1M"] },
];

export function MobileTimeframeSheet() {
  const tf = useChartStore((s) => s.timeframe);
  const setTf = useChartStore((s) => s.setTimeframe);
  const pinned = useChartStore((s) => s.pinnedTimeframes);
  const setPinned = useChartStore((s) => s.setPinnedTimeframes);
  const closeSheet = useMobileStore((s) => s.closeSheet);

  function select(t: Timeframe) {
    setTf(t);
    closeSheet();
  }

  function toggleFavorite(t: Timeframe) {
    if (pinned.includes(t)) {
      if (pinned.length <= 1) return; // keep at least one
      setPinned(pinned.filter((p) => p !== t));
    } else {
      setPinned([...pinned, t]);
    }
  }

  return (
    <MobileSheet title="Timeframe" onClose={closeSheet}>
      {TF_GROUPS.map((group) => (
        <section key={group.label}>
          <h3 className="bg-tv-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            {group.label}
          </h3>
          {group.values.map((t) => {
            const active = tf === t;
            const fav = pinned.includes(t);
            return (
              <div
                key={t}
                className={cn(
                  "flex items-center gap-3 border-b border-tv-border/60",
                  active && "bg-tv-blue/15",
                )}
              >
                <button
                  onClick={() => select(t)}
                  className="flex-1 px-3 py-3 text-left active:bg-tv-panel-hover"
                >
                  <span className={cn("text-sm font-medium", active && "text-tv-blue-text")}>
                    {TF_FULL[t]}
                  </span>
                </button>
                <button
                  onClick={() => toggleFavorite(t)}
                  aria-label={fav ? "Remove from bar" : "Add to bar"}
                  className="flex h-10 w-10 shrink-0 items-center justify-center text-tv-text-dim active:text-tv-yellow"
                >
                  <Star className={cn("h-4 w-4", fav && "fill-tv-yellow text-tv-yellow")} />
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </MobileSheet>
  );
}
