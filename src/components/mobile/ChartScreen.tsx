"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, Pencil, Redo2, Rewind, Sigma, Undo2 } from "lucide-react";
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
 * No top strip — the chart is full-bleed. A single bottom dock, stacked
 * directly above the app's bottom tab bar, is split into two zones:
 * a fixed left zone (symbol, timeframe — dropdown-style chips: tap opens
 * the picker sheet, swipe cycles inline) and a horizontally-scrolling right
 * zone with everything else (chart type, drawings, indicators, replay,
 * snapshot, alerts, undo, redo).
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

  // Edge shadows for the dock's scrollable right zone, signaling there is
  // more content past either edge. Driven off scroll position + size rather
  // than CSS scroll-shadows (no cross-browser support yet for the latter).
  const scrollZoneRef = useRef<HTMLDivElement>(null);
  const [edgeShadow, setEdgeShadow] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scrollZoneRef.current;
    if (!el) return;
    const update = () => {
      setEdgeShadow({
        left: el.scrollLeft > 0,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

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
      {/* Chart — full-bleed, nothing above it. */}
      <div className="relative min-h-0 flex-1">
        <PriceChart symbol={symbol} timeframe={timeframe} />
      </div>

      {/* Bottom dock, stacked directly above the app's bottom tab bar.
          Left zone (symbol, timeframe) is fixed and never scrolls; the
          right zone scrolls horizontally to fit the rest. */}
      <div className="flex h-12 shrink-0 items-stretch border-t border-tv-border bg-tv-panel">
        <div className="flex shrink-0 items-center gap-1 px-1">
          <SwipeChip
            label={symbol}
            onSwipe={nextSymbol}
            onTap={() => openSheet("symbolSearch")}
            ariaLabel="Symbol — tap to search, swipe to switch"
          />
          <SwipeChip
            label={timeframe.toUpperCase()}
            onSwipe={nextTimeframe}
            onTap={() => openSheet("timeframe")}
            ariaLabel="Timeframe — tap to pick, swipe to cycle pinned"
          />
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollZoneRef}
            className="no-scrollbar flex h-full items-center gap-1 overflow-x-auto pr-2"
          >
            <div className="flex h-full w-11 shrink-0 items-center justify-center">
              <ChartTypeSelector />
            </div>
            <button
              onClick={() => openSheet("drawings")}
              className="flex h-full w-11 shrink-0 items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Drawing tools"
            >
              <Pencil className="size-5" />
            </button>
            <button
              onClick={() => openSheet("indicators")}
              className="flex h-full w-11 shrink-0 items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Indicators"
            >
              <Sigma className="size-5" />
            </button>
            {!replayActive && (
              <button
                onClick={enterReplayPicking}
                className="flex h-full w-11 shrink-0 items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
                aria-label="Bar replay"
              >
                <Rewind className="size-5" />
              </button>
            )}
            <div className="flex h-full w-11 shrink-0 items-center justify-center">
              <SnapshotButton />
            </div>
            <button
              onClick={() => openSheet("alerts")}
              className="flex h-full w-11 shrink-0 items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Alerts"
            >
              <Bell className="size-5" />
            </button>
            <button
              onClick={() => void undo()}
              className="flex h-full w-11 shrink-0 items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Undo"
            >
              <Undo2 className="size-5" />
            </button>
            <button
              onClick={() => void redo()}
              className="flex h-full w-11 shrink-0 items-center justify-center text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Redo"
            >
              <Redo2 className="size-5" />
            </button>
          </div>
          {edgeShadow.left && (
            <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-tv-panel to-transparent" />
          )}
          {edgeShadow.right && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-tv-panel to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A dropdown-style chip with swipe-up / swipe-down detection (and a tap
 * fallback): value + a trailing chevron signal "tap opens a picker", while
 * the swipe cycles the value inline without opening anything. `touchAction:
 * "none"` is required for the swipe gesture to be reliably captured (a touch
 * browser otherwise treats it as a scroll attempt) — safe here since this
 * chip sits in the dock's fixed left zone, which never scrolls.
 */
function SwipeChip({
  label, onSwipe, onTap, ariaLabel,
}: {
  label: string;
  onSwipe: (dir: 1 | -1) => void;
  onTap: () => void;
  ariaLabel: string;
}) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [active, setActive] = useState(false);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 select-none items-center gap-0.5 rounded border border-tv-border bg-tv-bg px-2 py-1.5 text-xs font-semibold transition-colors",
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
      onTouchEnd={(e) => {
        // Suppress the browser's synthesized compatibility mouse events
        // (mousedown/mouseup/click) that follow a touch tap. Without this,
        // the synthesized mousedown lands on the just-opened dialog's
        // backdrop and Base UI's Dialog treats it as an outside press,
        // closing whatever onTap just opened on the same gesture.
        e.preventDefault();
      }}
    >
      <span className="max-w-[110px] truncate">{label}</span>
      <ChevronDown className="size-3 shrink-0 text-tv-text-muted" />
    </button>
  );
}
