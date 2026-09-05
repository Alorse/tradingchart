"use client";

import { useRef, useState } from "react";
import { Bell, Pencil, Redo2, Rewind, Sigma, Undo2 } from "lucide-react";
import { useChartStore } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useReplayStore } from "@/lib/replay/replay-store";
import { PriceChart } from "@/components/chart/PriceChart";
import { ChartTypeSelector } from "@/components/chart/ChartTypeSelector";
import { SnapshotButton } from "@/components/chart/SnapshotButton";
import { cn } from "@/lib/utils";

/**
 * Mobile chart screen.
 *
 * Slim top strip: symbol chip (swipe up/down → previous/next symbol in
 * active watchlist, tap → search) plus undo/redo/alerts. A bottom dock —
 * mirroring TradingView mobile — holds timeframe, chart type, drawings,
 * indicators, bar replay and snapshot, stacked directly above the app's
 * bottom tab bar.
 *
 * The chart itself uses the existing desktop <PriceChart /> — it already
 * supports pinch-zoom and pan on touch devices. `ChartTypeSelector` and
 * `SnapshotButton` are reused as-is from desktop: both are built on the
 * shared `DropdownMenu` primitive (tap-triggered, not hover), so they need
 * no touch adaptation.
 */
export function ChartScreen() {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const setTimeframe = useChartStore((s) => s.setTimeframe);
  const pinnedTimeframes = useChartStore((s) => s.pinnedTimeframes);
  const watchlists = useChartStore((s) => s.watchlists);
  const activeWatchlistId = useChartStore((s) => s.activeWatchlistId);
  const openSheet = useMobileStore((s) => s.openSheet);
  const { undo, redo } = useDrawings();
  const replayActive = useReplayStore((s) => s.active);
  const enterReplayPicking = useReplayStore((s) => s.enterPicking);

  // Build the rotating symbol list from the active watchlist.
  const wlSymbols = (() => {
    const w = watchlists.find((x) => x.id === activeWatchlistId);
    const list = (w?.items ?? []).filter((i) => i.type === "symbol").map((i) => i.value);
    return list.length > 0 ? list : [symbol];
  })();

  function cycle<T>(arr: T[], cur: T, dir: 1 | -1): T {
    if (arr.length === 0) return cur;
    const idx = arr.indexOf(cur);
    const next = idx === -1 ? 0 : (idx + dir + arr.length) % arr.length;
    return arr[next];
  }

  function nextSymbol(dir: 1 | -1) { setSymbol(cycle(wlSymbols, symbol, dir)); }
  // Cycles the *pinned* timeframes (same "quick access" list desktop's
  // header shows as chips) — the full set lives behind the tap-to-open sheet.
  function nextTimeframe(dir: 1 | -1) {
    setTimeframe(cycle(pinnedTimeframes.length > 0 ? pinnedTimeframes : [timeframe], timeframe, dir));
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top strip — symbol chip + undo/redo/alerts. Never scrolls; the
          symbol chip takes the remaining width. */}
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-tv-border bg-tv-panel px-2">
        <div className="min-w-0 flex-1">
          <SwipeChip
            label={symbol}
            onSwipe={nextSymbol}
            onTap={() => openSheet("symbolSearch")}
            ariaLabel="Symbol — tap to search, swipe to switch"
            fullWidth
          />
        </div>
        <button
          onClick={() => void undo()}
          className="shrink-0 rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Undo"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          onClick={() => void redo()}
          className="shrink-0 rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Redo"
        >
          <Redo2 className="size-4" />
        </button>
        <button
          onClick={() => openSheet("alerts")}
          className="shrink-0 rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Alerts"
        >
          <Bell className="size-4" />
        </button>
      </header>

      {/* Chart */}
      <div className="relative min-h-0 flex-1">
        <PriceChart symbol={symbol} timeframe={timeframe} />
      </div>

      {/* Bottom dock — timeframe, chart type, drawings, indicators, replay,
          snapshot. A grid (not scrollable) stacked directly above the app's
          bottom tab bar. */}
      <div className="grid h-12 shrink-0 grid-cols-6 border-t border-tv-border bg-tv-panel">
        <div className="flex h-full items-center justify-center">
          <SwipeChip
            label={timeframe.toUpperCase()}
            onSwipe={nextTimeframe}
            onTap={() => openSheet("timeframe")}
            ariaLabel="Timeframe — tap to pick, swipe to cycle pinned"
            compact
          />
        </div>
        <div className="flex h-full items-center justify-center">
          <ChartTypeSelector />
        </div>
        <button
          onClick={() => openSheet("drawings")}
          className="flex h-full items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Drawing tools"
        >
          <Pencil className="size-5" />
        </button>
        <button
          onClick={() => openSheet("indicators")}
          className="flex h-full items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Indicators"
        >
          <Sigma className="size-5" />
        </button>
        {!replayActive && (
          <button
            onClick={enterReplayPicking}
            className="flex h-full items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
            aria-label="Bar replay"
          >
            <Rewind className="size-5" />
          </button>
        )}
        <div className="flex h-full items-center justify-center">
          <SnapshotButton />
        </div>
      </div>
    </div>
  );
}

/**
 * A chip with swipe-up / swipe-down detection (and a tap fallback).
 * `touchAction: "none"` is required for the swipe gesture to be reliably
 * captured (a touch browser otherwise treats it as a scroll attempt), which
 * is safe here since neither the top strip nor the bottom dock scroll.
 */
function SwipeChip({
  label, onSwipe, onTap, ariaLabel, compact, fullWidth,
}: {
  label: string;
  onSwipe: (dir: 1 | -1) => void;
  onTap: () => void;
  ariaLabel: string;
  compact?: boolean;
  fullWidth?: boolean;
}) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [active, setActive] = useState(false);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "select-none rounded border border-tv-border bg-tv-bg text-sm font-semibold transition-colors",
        compact ? "px-2 py-2 text-xs" : "px-2.5 py-1",
        fullWidth ? "w-full truncate" : "shrink-0",
        active && "bg-tv-panel-hover",
      )}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
        setActive(true);
      }}
      onPointerUp={(e) => {
        setActive(false);
        const s = startRef.current;
        startRef.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        const dt = Date.now() - s.t;
        const SWIPE_PX = 24;
        // Vertical swipe wins — sign convention: swipe DOWN (positive dy) = previous,
        // swipe UP (negative dy) = next, matching how a wheel feels.
        if (Math.abs(dy) > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
          onSwipe(dy < 0 ? 1 : -1);
        } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 400) {
          onTap();
        }
      }}
      onPointerCancel={() => {
        startRef.current = null;
        setActive(false);
      }}
    >
      {label}
    </button>
  );
}
