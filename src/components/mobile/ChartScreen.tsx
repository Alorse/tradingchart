"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, Pencil, Redo2, Rewind, Sigma, Undo2 } from "lucide-react";
import { useChartStore } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useReplayStore } from "@/lib/replay/replay-store";
import { PriceChart } from "@/components/chart/PriceChart";
import { SnapshotButton } from "@/components/chart/SnapshotButton";
import { cn } from "@/lib/utils";

/**
 * Mobile chart screen.
 *
 * No top strip — the chart is full-bleed. A single bottom dock, stacked
 * directly above the app's bottom tab bar, is split into two zones:
 * a fixed left zone (symbol, timeframe — dropdown-style chips: tap opens
 * the picker sheet, swipe cycles inline) and a horizontally-scrolling right
 * zone with everything else (drawings, indicators, replay, snapshot, alerts,
 * undo, redo).
 *
 * The chart itself uses the existing desktop <PriceChart /> — it already
 * supports pinch-zoom and pan on touch devices. `SnapshotButton` is reused
 * as-is from desktop: it's built on the shared `DropdownMenu` primitive
 * (tap-triggered, not hover), so it needs no touch adaptation.
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

  // Neighboring values for the wheel-picker chips' dimmed prev/next slices.
  const timeframeCycleList = pinnedTimeframes.length > 0 ? pinnedTimeframes : [timeframe];
  const prevSymbolLabel = cycle(wlSymbols, symbol, -1);
  const nextSymbolLabel = cycle(wlSymbols, symbol, 1);
  const prevTimeframeLabel = cycle(timeframeCycleList, timeframe, -1).toUpperCase();
  const nextTimeframeLabel = cycle(timeframeCycleList, timeframe, 1).toUpperCase();

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
            prevLabel={prevSymbolLabel}
            nextLabel={nextSymbolLabel}
            onSwipe={nextSymbol}
            onTap={() => openSheet("symbolSearch")}
            ariaLabel="Symbol — tap to search, swipe to switch"
            className="w-[80px]"
          />
          <SwipeChip
            label={timeframe.toUpperCase()}
            prevLabel={prevTimeframeLabel}
            nextLabel={nextTimeframeLabel}
            onSwipe={nextTimeframe}
            onTap={() => openSheet("timeframe")}
            ariaLabel="Timeframe — tap to pick, swipe to cycle pinned"
            className="w-[44px]"
          />
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollZoneRef}
            className="no-scrollbar flex h-full items-center gap-1 overflow-x-auto pr-2"
          >
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

// Fade only the outer few pixels of the chip into the dock background — most
// of the prev/next rows stay fully opaque and readable; only the very top
// and bottom edges dissolve.
const WHEEL_MASK_VERTICAL =
  "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)";
// The center value is left-aligned, so a label longer than the chip clips at
// the right edge instead of both ends — this fades the last ~quarter of the
// chip's width so that clip dissolves rather than cutting off hard.
const WHEEL_MASK_HORIZONTAL =
  "linear-gradient(to right, black 0%, black 85%, transparent 100%)";
// The two gradients are stacked as separate mask layers and intersected
// (each layer's alpha multiplies), so a pixel only stays opaque if it's both
// away from the top/bottom edges AND away from the right edge.
// `-webkit-mask-composite: source-in` is Safari's pre-standard equivalent of
// `mask-composite: intersect` (Porter-Duff "source-in" applied against the
// previous layer) — both are needed for iOS.
const WHEEL_MASK_IMAGE = `${WHEEL_MASK_VERTICAL}, ${WHEEL_MASK_HORIZONTAL}`;

/**
 * A wheel-picker-style chip (TradingView mobile's symbol/interval roller):
 * the current value sits bold and bright in the center, with the previous/
 * next value shown above and below in a dimmed-but-readable grey, separated
 * from the center by real vertical air. Only the outer edges of the chip
 * fade into the background — the rows themselves stay sharp (no ellipsis
 * truncation; overflow-hidden only clips an over-long label horizontally).
 * The center value is left-aligned (prev/next stay centered) so a label
 * longer than the fixed chip width clips only at the trailing end, and the
 * horizontal mask layer fades that clipped end instead of cutting it off
 * hard. Swipe up/down cycles the value; tap opens the full picker sheet.
 * `touchAction: "none"` is required for the swipe gesture to be reliably
 * captured (a touch browser otherwise treats it as a scroll attempt) — safe
 * here since this chip sits in the dock's fixed left zone, which never
 * scrolls.
 */
function SwipeChip({
  label, prevLabel, nextLabel, onSwipe, onTap, ariaLabel, className,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onSwipe: (dir: 1 | -1) => void;
  onTap: () => void;
  ariaLabel: string;
  className?: string;
}) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [active, setActive] = useState(false);
  // Remembered only to pick which way the center value's spin-in animation
  // slides from; a tap-driven change (picked from the sheet) just reuses
  // whatever direction was last swiped.
  const [dir, setDir] = useState<1 | -1>(1);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "relative flex h-11 shrink-0 select-none flex-col items-center justify-center gap-1 overflow-hidden pl-1 pr-2 transition-colors",
        active && "bg-tv-panel-hover",
        className,
      )}
      style={{
        touchAction: "none",
        WebkitMaskImage: WHEEL_MASK_IMAGE,
        maskImage: WHEEL_MASK_IMAGE,
        WebkitMaskComposite: "source-in",
        maskComposite: "intersect",
      } as CSSProperties}
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
          const swipeDir = dy < 0 ? 1 : -1;
          setDir(swipeDir);
          onSwipe(swipeDir);
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
      <span className="block whitespace-nowrap text-[10px] leading-none text-tv-text-muted">
        {prevLabel}
      </span>
      <span
        key={label}
        style={{ "--wheel-spin-from": `${dir * 6}px` } as CSSProperties}
        className="block w-full whitespace-nowrap text-left text-xs leading-none font-bold text-tv-text [animation:wheel-chip-spin_140ms_ease-out]"
      >
        {label}
      </span>
      <span className="block whitespace-nowrap text-[10px] leading-none text-tv-text-muted">
        {nextLabel}
      </span>
    </button>
  );
}
