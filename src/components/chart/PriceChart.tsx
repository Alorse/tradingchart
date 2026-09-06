"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  CrosshairMode,
  PriceScaleMode,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
  type MouseEventParams,
} from "lightweight-charts";
import { getBinanceWS } from "@/lib/binance/ws";
import { getBybitWS } from "@/lib/bybit/ws";
import {
  extractSymbols,
  evaluateCandleAt,
} from "@/lib/binance/synthetic";
import { fetchCandles } from "@/lib/data/fetch";
import { resolveSource } from "@/lib/symbols/source";
import { getSymbolInfo } from "@/lib/trading/symbol-info";
import { ema, rsi, macd, obv, bollingerBands, vwap as vwapCalc } from "@/lib/indicators";
import type { BandPoint } from "@/lib/indicators";
import { SIMPLE_OSCILLATORS, type SimpleOscKey } from "@/lib/indicators/pane-specs";
import { adx as adxCalc } from "@/lib/indicators/adx";
import { squeezeMomentum } from "@/lib/indicators/squeeze";
import { SqueezeOverlay } from "./SqueezeOverlay";
import { vumanchu as vumanchuCalc } from "@/lib/indicators/vumanchu";
import type { Candle, Timeframe } from "@/lib/binance/types";
import {
  INDICATOR_COLORS,
  SUB_PANE_KEYS,
  isSubPaneKey,
  useChartStore,
  type IndicatorKey,
  type SubPaneKey,
  DEFAULT_CHART_COLORS,
} from "@/lib/store/chart-store";
import { formatPrice, formatVolume, priceFormatFor, exchangePriceFormatFor } from "@/lib/format";
import { ArrowUpDown, Bell, ChevronUp, Maximize2, Settings2 } from "lucide-react";
import { IndicatorPill } from "./IndicatorPill";
import { MeasureOverlay } from "./MeasureOverlay";
import { DrawingsLayer } from "./drawings/DrawingsLayer";
import { PlacementPreview, MagnetIndicator } from "./PlacementPreview";
import { OrderLinesLayer } from "@/components/trading/OrderLinesLayer";
import { PaperOrderLinesLayer } from "@/components/trading/PaperOrderLinesLayer";
import { BuySellOverlay } from "@/components/trading/BuySellOverlay";
import { FloatingContextToolbar } from "./FloatingContextToolbar";
import { BarCountdown } from "./BarCountdown";
import { PositionPriceLabels } from "./drawings/PositionPriceLabels";
import { KeyLevelsOverlay } from "./KeyLevelsOverlay";
import { VolumeProfileOverlay } from "./VolumeProfileOverlay";
import { BandFillOverlay } from "./BandFillOverlay";
import { computeKeyLevels } from "@/lib/indicators/keylevels";
import type { SqueezePoint } from "@/lib/indicators/squeeze";
import { xToTime, timeToX, timeframeToSeconds, timeframeLabel } from "@/lib/chart/coords";
import { getTvColors, getTvFontFamily, TV_PINE, TV_STUDY } from "@/lib/chart/theme";
import { useReplayStore } from "@/lib/replay/replay-store";
import { ReplayToolbar } from "./ReplayToolbar";
import { candlesRef as globalCandlesRef } from "@/lib/chart/candles-ref";
import { magnetSnap } from "@/lib/chart/magnet";
import { normalizeRatios, adaptRatios } from "@/lib/chart/pane-layout";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { unifiedHistory, registerViewportApplier, isApplyingHistory } from "@/lib/history";
import { registerPricePerPixel } from "@/lib/chart/nudge";
import { registerChartCapture, composeChartPng } from "@/lib/chart/snapshot";
import { generateId, FIB_LEVELS_DEFAULT } from "@/lib/drawings/types";
import { FIB_EXT_RATIOS_DEFAULT } from "@/lib/drawings/fib";
import { useAlertMonitor } from "@/hooks/useAlertMonitor";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { useIsMobile, MOBILE_BREAKPOINT } from "@/hooks/useIsMobile";

interface MeasurePoint {
  time: number;
  price: number;
}
interface MeasureState {
  phase: "idle" | "placing" | "done";
  a: MeasurePoint | null;
  b: MeasurePoint | null;
}
const INITIAL_MEASURE: MeasureState = { phase: "idle", a: null, b: null };

function durationLabel(aTime: number, bTime: number): string {
  const diff = Math.abs(bTime - aTime);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

interface Props {
  symbol: string;
  timeframe: Timeframe;
}

// Palette lives in globals.css (`--color-tv-*`); read it once so the chart
// canvas stays in sync with the CSS/Tailwind theme. See src/lib/chart/theme.ts.
const TV_COLORS = getTvColors();

// Volume bars and the MACD histogram tint by direction at a fixed alpha. Both
// arms are constant, so they are built once here rather than re-concatenated
// per bar inside the `setData` maps below (a few thousand bars per load, replay
// scrub, timeframe switch and symbol switch).
const VOL_UP = `${TV_COLORS.green}66`;
const VOL_DOWN = `${TV_COLORS.red}66`;
const MACD_HIST_UP = `${TV_COLORS.green}80`;
const MACD_HIST_DOWN = `${TV_COLORS.red}80`;

/** Volume bar tint for one bar, by whether it closed up. */
const volumeColor = (bar: { open: number; close: number }) =>
  bar.close >= bar.open ? VOL_UP : VOL_DOWN;

// Tools whose second point snaps to a horizontal/vertical axis while Shift is held.
const AXIS_CONSTRAIN_TOOLS = new Set<string>(["trendline", "ray", "arrow"]);

// Long-press timing for the touch equivalent of the right-click context menu
// (mirrors WatchlistScreen's pointerdown-timer + slop pattern).
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/**
 * With Shift held, snap `cur` to a horizontal or vertical line relative to
 * `first` — whichever the drag is closer to, measured in screen pixels (so the
 * decision isn't skewed by price/time having wildly different scales).
 */
function constrainToAxis(
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  candles: Candle[],
  intervalSec: number,
  first: { time: number; price: number },
  cur: { time: number; price: number },
): { time: number; price: number } {
  const fx = timeToX(chart, first.time, candles, intervalSec);
  const fy = candleSeries.priceToCoordinate(first.price);
  const cx = timeToX(chart, cur.time, candles, intervalSec);
  const cy = candleSeries.priceToCoordinate(cur.price);
  if (fx === null || fy === null || cx === null || cy === null) return cur;
  return Math.abs(cx - fx) >= Math.abs(cy - fy)
    ? { time: cur.time, price: first.price } // horizontal
    : { time: first.time, price: cur.price }; // vertical
}

// Shared row style for the chart right-click context menu.
const MENU_ITEM_CLS =
  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-tv-text hover:bg-tv-panel-hover";

interface HoverInfo {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  time: number;
  pct: number;
}

interface LastValues {
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  volume?: number;
  bb?: number;
  vwap?: number;
  stochrsi?: number;
  williamsr?: number;
  atr?: number;
  cci?: number;
  mfi?: number;
}

interface PaneOffset {
  top: number;
  height: number;
}

export function PriceChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  /** Per-user EMA instance: id → series */
  const emaSeriesMapRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi30Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi70Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // ADX pane
  const adxRef = useRef<ISeriesApi<"Line"> | null>(null);
  const adxPlusDIRef = useRef<ISeriesApi<"Line"> | null>(null);
  const adxMinusDIRef = useRef<ISeriesApi<"Line"> | null>(null);
  const adxKeyLevelRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Squeeze Momentum pane
  const squeezeHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const squeezeDotsRef = useRef<ISeriesApi<"Line"> | null>(null);
  const squeezeDotsMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // VuManChu pane
  const vmcWt1Ref = useRef<ISeriesApi<"Area"> | null>(null);
  const vmcWt2Ref = useRef<ISeriesApi<"Area"> | null>(null);
  const vmcVwapRef = useRef<ISeriesApi<"Area"> | null>(null);
  const vmcMfiRef = useRef<ISeriesApi<"Area"> | null>(null);
  const vmcRsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vmcObRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vmcOsRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vmcZeroRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vmcMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // OBV pane
  const obvRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Bollinger Bands + VWAP — main-pane overlays
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMidRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  /** Spec-driven oscillator panes (Stoch RSI, %R, ATR, CCI, MFI): key → series. */
  const simpleOscRef = useRef<
    Map<SimpleOscKey, { lines: ISeriesApi<"Line">[]; guides: ISeriesApi<"Line">[] }>
  >(new Map());
  const candlesRef = useRef<Candle[]>([]);
  // Shape of the current view (bar span + offset from the last bar), kept fresh
  // as the user pans/zooms so it survives a symbol change and can be reapplied
  // to keep the same zoom + scroll position on the next symbol.
  const viewShapeRef = useRef<{ span: number; rightOffset: number } | null>(null);
  // Full candle array snapshot captured when bar replay starts (candlesRef holds
  // the truncated slice while replay is active).
  const replayFullRef = useRef<Candle[]>([]);
  const savedPaneHeightsRef = useRef<number[]>([]);
  /** Previous `subPanesHidden`, so the collapse effect can tell a real
   *  transition from a re-run caused by an indicator being toggled. */
  const prevSubPanesHiddenRef = useRef(false);
  const firstPointRef = useRef<{ time: number; price: number } | null>(null);
  const placementPointsRef = useRef<Array<{ time: number; price: number }>>([]);
  // Last unconstrained cursor (time/price) — lets Shift snap the preview the
  // instant it's pressed, without needing a mouse move.
  const lastCursorRef = useRef<{ time: number; price: number } | null>(null);
  // Tracked Shift state — the chart's crosshair events don't reliably carry the
  // modifier while moving, so we key the axis-constrain off our own ref.
  const shiftHeldRef = useRef(false);
  const chartColorsRef = useRef(DEFAULT_CHART_COLORS);

  const indicators = useChartStore((s) => s.indicators);
  const hidden = useChartStore((s) => s.hidden);
  const config = useChartStore((s) => s.config);
  const userEMAs = useChartStore((s) => s.userEMAs);
  const removeUserEMA = useChartStore((s) => s.removeUserEMA);
  const toggleUserEMAHidden = useChartStore((s) => s.toggleUserEMAHidden);
  const adxStyle = useChartStore((s) => s.adxStyle);
  const squeezeStyle = useChartStore((s) => s.squeezeStyle);
  const bollingerStyle = useChartStore((s) => s.bollingerStyle);
  const vwapStyle = useChartStore((s) => s.vwapStyle);
  const volumeProfileCfg = useChartStore((s) => s.volumeProfile);
  const indicatorOverlays = useChartStore((s) => s.indicatorOverlays);
  const paneZOrder = useChartStore((s) => s.paneZOrder);
  const setPaneZOrder = useChartStore((s) => s.setPaneZOrder);
  const mainPaneOrder = useChartStore((s) => s.mainPaneOrder);
  const setMainPaneOrder = useChartStore((s) => s.setMainPaneOrder);
  const logScale = useChartStore((s) => s.logScale);
  const indicatorLogScale = useChartStore((s) => s.indicatorLogScale);
  const mainPriceScaleMode = useChartStore((s) => s.mainPriceScaleMode);
  const mainPriceScaleInverted = useChartStore((s) => s.mainPriceScaleInverted);
  const pillsCollapsed = useChartStore((s) => s.pillsCollapsed);
  const subPanesHidden = useChartStore((s) => s.subPanesHidden);
  const showBarCountdown = useChartStore((s) => s.showBarCountdown);
  const keyLevelsCfg = useChartStore((s) => s.keyLevels);
  const chartColors = useChartStore((s) => s.chartColors);
  chartColorsRef.current = chartColors;
  const chartType = useChartStore((s) => s.chartType);
  const tool = useChartStore((s) => s.tool);
  const setTool = useChartStore((s) => s.setTool);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const toggleHidden = useChartStore((s) => s.toggleHidden);
  const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);
  const setIndicatorOverlay = useChartStore((s) => s.setIndicatorOverlay);
  const openAlertDialog = useChartStore((s) => s.openAlertDialog);
  const setCurrentLivePrice = useChartStore((s) => s.setCurrentLivePrice);

  // Bar replay state (drives the truncated candle feed below).
  const replayActive = useReplayStore((s) => s.active);
  const replayPicking = useReplayStore((s) => s.picking);
  const replayPlaying = useReplayStore((s) => s.playing);
  const replaySpeed = useReplayStore((s) => s.speed);
  // NOTE: cursorIndex is intentionally NOT subscribed as a selector — it changes
  // up to ~60×/s, and re-rendering this large component per tick crashes the
  // renderer. The feed reads it imperatively and coalesces to one frame (below).
  const drawingsApi = useDrawings();
  // Note: useAlertMonitor relies on lastPrice (state); see below where it's invoked.

  // Refs to avoid recreating subscribeClick on every tool change
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const drawingsApiRef = useRef(drawingsApi);
  drawingsApiRef.current = drawingsApi;
  const setToolRef = useRef(setTool);
  setToolRef.current = setTool;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const configRef = useRef(config);
  configRef.current = config;

  const [chartContextMenu, setChartContextMenu] = useState<{ x: number; y: number; price: number; region: "chart" | "scale" } | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [lastPrice, setLastPrice] = useState<{ value: number; pct: number } | null>(null);
  const [lastValues, setLastValues] = useState<LastValues>({});
  const [paneOffsets, setPaneOffsets] = useState<PaneOffset[]>([]);
  // Whether each pane's price scale is currently in auto-scale mode, so the
  // "A" button can highlight like "L" does — keyed the same as those buttons
  // ("main" | IndicatorKey). Undefined reads as true (the library's default).
  // Re-synced after any mouseup, since dragging the price scale flips this
  // off internally with no public change event to subscribe to.
  const [autoScaleOn, setAutoScaleOn] = useState<Record<string, boolean>>({});
  const [measure, setMeasure] = useState<MeasureState>(INITIAL_MEASURE);
  const [dragKey, setDragKey] = useState<IndicatorKey | null>(null);
  const pointerDragRef = useRef<{ key: IndicatorKey } | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [previewState, setPreviewState] = useState<{
    first: { time: number; price: number } | null;
    extra: Array<{ time: number; price: number }>;
    cursor: { time: number; price: number } | null;
  } | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [magnetTarget, setMagnetTarget] = useState<{ time: number; price: number } | null>(null);
  const [squeezePts, setSqueezePts] = useState<SqueezePoint[]>([]);
  // Band rails are kept in state (not just in the series) because the
  // translucent fill is an SVG overlay that needs the raw prices.
  const [bbPts, setBbPts] = useState<BandPoint[]>([]);
  /** Symbol tick size once exchange-info resolves — Volume Profile's
   *  "ticks per row" layout is meaningless without it. */
  const [symbolTickSize, setSymbolTickSize] = useState<number | undefined>(undefined);
  const [vwapPts, setVwapPts] = useState<BandPoint[]>([]);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const latestCrosshairParamRef = useRef<MouseEventParams<Time> | null>(null);
  const paneOffsetsRef = useRef(paneOffsets);
  paneOffsetsRef.current = paneOffsets;
  const indicatorPaneIdxRef = useRef<Record<SubPaneKey, number>>(
    Object.fromEntries(SUB_PANE_KEYS.map((k, i) => [k, i + 1])) as Record<SubPaneKey, number>,
  );

  // Drive alerts off the live price tick
  useAlertMonitor(symbol, lastPrice?.value ?? null);
  // Paper-trading fills/brackets are driven by `usePaperExposureFeed`,
  // mounted once in providers.tsx for every symbol the account has exposure
  // to — not just this chart's — so a position stays live while a different
  // symbol is charted.
  // Selects which of the two order-line layers is mounted below. Live
  // credentials can still be configured while the Trade tab is toggled to
  // Paper, so each layer is gated on its own mode — otherwise a chart carries
  // the other account's lines on top of its own. Both create their price
  // lines imperatively in an effect, so each has to be *unmounted* rather
  // than hidden: a JSX-level `return null` inside them wouldn't tear those
  // lines down.
  const tradingMode = useTradingModeStore((s) => s.mode);
  const isMobile = useIsMobile();

  // Helper — compute pane top offsets from chart layout
  function recomputePaneOffsets() {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    let top = 0;
    const offsets: PaneOffset[] = panes.map((p) => {
      const h = p.getHeight();
      const o = { top, height: h };
      top += h;
      return o;
    });
    setPaneOffsets(offsets);
  }

  /**
   * Save the current pane layout as ratios of the total height. Called only
   * from the separator drag-resize path — the ResizeObserver fires on
   * container resize, where the library has already re-laid the panes out, so
   * capturing there would overwrite the user's choice with a derived one.
   */
  function capturePaneRatios() {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    // A single pane carries no layout, and saving [1] would poison the ratios
    // for whenever a sub-pane indicator comes back.
    if (panes.length < 2) return;
    // Collapsed sub-panes sit at ~0px (stretch factor 0), so a layout captured
    // now could never be expanded back.
    if (useChartStore.getState().subPanesHidden) return;
    const ratios = normalizeRatios(panes.map((p) => p.getHeight()));
    if (!ratios) return;
    const prev = useChartStore.getState().paneRatios;
    const unchanged =
      prev?.length === ratios.length && prev.every((r, i) => Math.abs(r - ratios[i]) < 0.005);
    if (unchanged) return;
    useChartStore.getState().setPaneRatios(ratios);
  }

  /**
   * Restore the persisted layout. Stretch factors are relative, so feeding
   * them the ratios directly reproduces the same proportions at any height.
   */
  function applyPaneRatios() {
    if (!chartRef.current) return;
    const state = useChartStore.getState();
    // While collapsed the stretch factors belong to the collapse effect.
    if (state.subPanesHidden) return;
    const panes = chartRef.current.panes();
    const ratios = adaptRatios(state.paneRatios, panes.length);
    if (!ratios) return;
    panes.forEach((p, i) => p.setStretchFactor(ratios[i]));
  }

  /**
   * Called right after a sub-pane creation effect adds its series. Sets the
   * site's own default stretch factors first — today's behavior, and what a
   * fresh user with no persisted layout still gets — then immediately overlays
   * any persisted ratios on top. Pane-creation effects can run after
   * `applyPaneRatios()` already fired once (a later-toggled indicator, or a
   * rehydration that lands after the initial load), and without this second
   * call their hardcoded default would be the last word, silently discarding
   * a restored/dragged layout.
   */
  function applyPaneLayout(paneIndex: number, defaultSubStretch: number) {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    panes[paneIndex]?.setStretchFactor(defaultSubStretch);
    panes[0]?.setStretchFactor(3);
    applyPaneRatios();
  }

  // Re-read each pane's actual autoScale flag off its series, so the "A"
  // button's highlight reflects reality after a price-scale drag (which
  // flips it off internally) without a public event to react to instead.
  function resyncAutoScaleStates() {
    const next: Record<string, boolean> = {};
    const bySeries: Record<string, ISeriesApi<SeriesType> | null> = {
      main: candleSeriesRef.current,
      rsi: rsiRef.current,
      macd: macdRef.current,
      adx: adxRef.current,
      squeeze: squeezeHistRef.current,
      vumanchu: vmcWt2Ref.current,
    };
    for (const [key, s] of Object.entries(bySeries)) {
      if (s) next[key] = s.priceScale().options().autoScale;
    }
    setAutoScaleOn(next);
  }

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const initColors = chartColorsRef.current;
    // The `useIsMobile` hook's state is still false on this first effect pass
    // (its own effect hasn't run yet), so first paint would flash desktop
    // sizing on a phone unless read synchronously here instead.
    const mobileNow = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: initColors.bg },
        textColor: TV_COLORS.text,
        // Resolved, not `var(--font-sans)`: an unresolved var() makes the
        // canvas font string invalid, which silently drops fontSize too.
        fontFamily: getTvFontFamily(),
        fontSize: mobileNow ? 11 : 14,
        panes: { separatorColor: TV_COLORS.border, separatorHoverColor: TV_COLORS.borderStrong },
      },
      grid: {
        vertLines: { color: initColors.gridLines },
        horzLines: { color: initColors.gridLines },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
        horzLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
      },
      rightPriceScale: {
        // The axis frames the plot, so it reads one step above the pane
        // separators rather than at the same weight.
        borderColor: TV_COLORS.borderStrong,
        textColor: TV_COLORS.text,
        // Less headroom above the highest bar (default top is ~0.2, which on a
        // log scale squeezes the candles). Bottom leaves room for the volume overlay.
        scaleMargins: { top: 0.06, bottom: 0.08 },
        // Floor only — grows for wider prices. Mobile's smaller fontSize would
        // otherwise auto-fit the axis narrower than a comfortable tap target.
        minimumWidth: mobileNow ? 56 : 0,
      },
      timeScale: {
        borderColor: TV_COLORS.borderStrong,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      autoSize: true,
    });

    // PANE 0 — Candles + EMAs
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: initColors.bodyUp,
      downColor: initColors.bodyDown,
      borderUpColor: initColors.borderUp,
      borderDownColor: initColors.borderDown,
      wickUpColor: initColors.wickUp,
      wickDownColor: initColors.wickDown,
      priceLineColor: TV_COLORS.textMuted,
      priceLineStyle: 2,
    });

    const initChartType = useChartStore.getState().chartType;
    lineSeriesRef.current = chart.addSeries(LineSeries, {
      color: TV_PINE.blue,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: initChartType === "line",
    });
    areaSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: TV_PINE.blue,
      topColor: "rgba(41,98,255,0.4)",
      bottomColor: "rgba(41,98,255,0.0)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: initChartType === "area",
    });
    if (initChartType !== "candles") {
      candleSeriesRef.current.applyOptions({ visible: false });
    }

    chartRef.current = chart;

    // Click handler — drawing tools
    chart.subscribeClick((param) => {
      if (!param.point || !candleSeriesRef.current) return;
      const rawPrice = candleSeriesRef.current.coordinateToPrice(param.point.y);
      if (rawPrice === null || !isFinite(rawPrice as number)) return;
      let price: number = rawPrice as number;

      // Resolve cursor time — extrapolate past last candle if needed
      const intervalSec = timeframeToSeconds(
        useChartStore.getState().timeframe,
      );
      let resolvedTime: number | null = param.time ? Number(param.time) : null;
      if (resolvedTime === null) {
        resolvedTime = xToTime(
          chart,
          param.point.x,
          candlesRef.current,
          intervalSec,
        );
      }

      // Bar-replay start picker: a click chooses the bar to begin replay from.
      if (useReplayStore.getState().picking) {
        const arr = replayFullRef.current.length ? replayFullRef.current : candlesRef.current;
        if (resolvedTime !== null && arr.length) {
          let idx = arr.findIndex((c) => c.time >= resolvedTime!);
          if (idx === -1) idx = arr.length - 1;
          useReplayStore.getState().setTotal(arr.length);
          useReplayStore.getState().setStart(idx);
          // Deliberately do NOT move the viewport: the later candles just vanish
          // in place, leaving room to the right for replay to reveal them.
        }
        return;
      }

      // Magnet: Ctrl held, or the persistent magnet-mode toggle → snap price
      // to the nearest candle OHLC or other drawing's level
      if (
        (param.sourceEvent?.ctrlKey || useChartStore.getState().magnetMode) &&
        resolvedTime !== null
      ) {
        const snapped = magnetSnap(price, resolvedTime, candlesRef.current);
        if (snapped !== null) price = snapped;
      }

      // Measure dismiss: any non-shift click in "done" phase clears it
      // (Shift+click is handled by capture-phase listener on outerRef)
      if (measureRef.current.phase === "done" && !param.sourceEvent?.shiftKey) {
        setMeasure(INITIAL_MEASURE);
      }

      // Cursor click on empty chart area → deselect any selected drawing
      if (toolRef.current === "cursor") {
        useDrawingsStore.getState().setSelected(null);
        return;
      }

      if (toolRef.current === "hline") {
        void drawingsApiRef.current.add({
          id: generateId(),
          kind: "hline",
          symbol: symbolRef.current,
          price,
          ...(useChartStore.getState().toolDefaults["hline"] ?? {}),
        });
        setToolRef.current("cursor");
        return;
      }

      if (toolRef.current === "vline") {
        if (resolvedTime === null) return;
        void drawingsApiRef.current.add({
          id: generateId(),
          kind: "vline",
          symbol: symbolRef.current,
          time: resolvedTime,
          ...(useChartStore.getState().toolDefaults["vline"] ?? {}),
        });
        setToolRef.current("cursor");
        return;
      }

      if (toolRef.current === "hray") {
        if (resolvedTime === null) return;
        void drawingsApiRef.current.add({
          id: generateId(),
          kind: "hray",
          symbol: symbolRef.current,
          anchor: { time: resolvedTime, price },
          ...(useChartStore.getState().toolDefaults["hray"] ?? {}),
        });
        setToolRef.current("cursor");
        return;
      }

      if (toolRef.current === "text") {
        if (resolvedTime === null) return;
        void drawingsApiRef.current.add({
          id: generateId(),
          kind: "text",
          symbol: symbolRef.current,
          anchor: { time: resolvedTime, price },
          text: "",
          ...(useChartStore.getState().toolDefaults["text"] ?? {}),
        } as Parameters<typeof drawingsApiRef.current.add>[0]);
        setToolRef.current("cursor");
        return;
      }

      // Callout: click 1 = the point it marks, click 2 = the text-box position.
      if (toolRef.current === "callout") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const first = firstPointRef.current;
        if (!first) {
          firstPointRef.current = { time, price };
          setPreviewState({ first: { time, price }, extra: [], cursor: { time, price } });
        } else {
          void drawingsApiRef.current.add({
            id: generateId(),
            kind: "callout",
            symbol: symbolRef.current,
            anchor: first,
            target: { time, price },
            text: "",
            ...(useChartStore.getState().toolDefaults["callout"] ?? {}),
          } as Parameters<typeof drawingsApiRef.current.add>[0]);
          firstPointRef.current = null;
          setPreviewState(null);
          setToolRef.current("cursor");
        }
        return;
      }

      // XABCD harmonic: five clicks (X, A, B, C, D).
      if (toolRef.current === "xabcd") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        placementPointsRef.current.push({ time, price });
        if (placementPointsRef.current.length >= 5) {
          void drawingsApiRef.current.add({
            id: generateId(),
            kind: "xabcd",
            symbol: symbolRef.current,
            points: [...placementPointsRef.current],
            ...(useChartStore.getState().toolDefaults["xabcd"] ?? {}),
          } as Parameters<typeof drawingsApiRef.current.add>[0]);
          placementPointsRef.current = [];
          setPreviewState(null);
          setToolRef.current("cursor");
        } else {
          const pts = placementPointsRef.current;
          setPreviewState({ first: pts[0] ?? null, extra: pts.slice(1), cursor: { time, price } });
        }
        return;
      }

      if (
        toolRef.current === "trendline" ||
        toolRef.current === "ray" ||
        toolRef.current === "arrow"
      ) {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const first = firstPointRef.current;
        const kind = toolRef.current;
        if (!first) {
          firstPointRef.current = { time, price };
          setPreviewState({ first: { time, price }, extra: [], cursor: { time, price } });
        } else {
          let b = { time, price };
          if ((shiftHeldRef.current || param.sourceEvent?.shiftKey) && candleSeriesRef.current) {
            b = constrainToAxis(chart, candleSeriesRef.current, candlesRef.current, intervalSec, first, b);
          }
          void drawingsApiRef.current.add({
            id: generateId(),
            kind,
            symbol: symbolRef.current,
            a: first,
            b,
            ...(useChartStore.getState().toolDefaults[kind] ?? {}),
          } as Parameters<typeof drawingsApiRef.current.add>[0]);
          firstPointRef.current = null;
          setPreviewState(null);
          setToolRef.current("cursor");
        }
        return;
      }

      // Long/short placement is handled entirely by the capture-phase
      // mousedown/mousemove/mouseup effect below (it needs to distinguish a
      // plain click from a click-drag that sets the right edge), which
      // stops propagation so this click handler never sees that gesture.

      if (toolRef.current === "price-range") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const first = firstPointRef.current;
        if (!first) {
          firstPointRef.current = { time, price };
          setPreviewState({ first: { time, price }, extra: [], cursor: { time, price } });
        } else {
          void drawingsApiRef.current.add({
            id: generateId(),
            kind: "price-range",
            symbol: symbolRef.current,
            priceA: first.price,
            priceB: price,
            timeA: first.time,
            timeB: time,
            ...(useChartStore.getState().toolDefaults["price-range"] ?? {}),
          });
          firstPointRef.current = null;
          setPreviewState(null);
          setToolRef.current("cursor");
        }
        return;
      }

      if (toolRef.current === "rectangle") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const first = firstPointRef.current;
        if (!first) {
          firstPointRef.current = { time, price };
          setPreviewState({ first: { time, price }, extra: [], cursor: { time, price } });
        } else {
          void drawingsApiRef.current.add({
            id: generateId(),
            kind: "rectangle",
            symbol: symbolRef.current,
            a: { time: first.time, price: first.price },
            b: { time, price },
            ...(useChartStore.getState().toolDefaults["rectangle"] ?? {}),
          });
          firstPointRef.current = null;
          setPreviewState(null);
          setToolRef.current("cursor");
        }
        return;
      }

      if (toolRef.current === "date-range") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const first = firstPointRef.current;
        if (!first) {
          firstPointRef.current = { time, price };
          setPreviewState({ first: { time, price }, extra: [], cursor: { time, price } });
        } else {
          void drawingsApiRef.current.add({
            id: generateId(),
            kind: "date-range",
            symbol: symbolRef.current,
            timeA: first.time,
            timeB: time,
            ...(useChartStore.getState().toolDefaults["date-range"] ?? {}),
          });
          firstPointRef.current = null;
          setPreviewState(null);
          setToolRef.current("cursor");
        }
        return;
      }

      if (toolRef.current === "fib-retracement") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const first = firstPointRef.current;
        if (!first) {
          firstPointRef.current = { time, price };
          setPreviewState({ first: { time, price }, extra: [], cursor: { time, price } });
        } else {
          void drawingsApiRef.current.add({
            id: generateId(),
            kind: "fib-retracement",
            symbol: symbolRef.current,
            a: first,
            b: { time, price },
            levels: [...FIB_LEVELS_DEFAULT],
            ...(useChartStore.getState().toolDefaults["fib-retracement"] ?? {}),
          });
          firstPointRef.current = null;
          setPreviewState(null);
          setToolRef.current("cursor");
        }
        return;
      }

      if (
        toolRef.current === "parallel-channel" ||
        toolRef.current === "fib-extension" ||
        toolRef.current === "pitchfork"
      ) {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const kind = toolRef.current;
        placementPointsRef.current.push({ time, price });
        if (placementPointsRef.current.length >= 3) {
          const [a, b, c] = placementPointsRef.current;
          void drawingsApiRef.current.add({
            id: generateId(),
            kind,
            symbol: symbolRef.current,
            a,
            b,
            c,
            ...(kind === "fib-extension" ? { levels: FIB_EXT_RATIOS_DEFAULT } : {}),
            ...(useChartStore.getState().toolDefaults[kind] ?? {}),
          } as Parameters<typeof drawingsApiRef.current.add>[0]);
          placementPointsRef.current = [];
          setPreviewState(null);
          setToolRef.current("cursor");
        } else {
          // Update preview with the new accumulated point
          const pts = placementPointsRef.current;
          setPreviewState({
            first: pts[0] ?? null,
            extra: pts.slice(1),
            cursor: { time, price },
          });
        }
        return;
      }

      if (toolRef.current === "measure") {
        if (resolvedTime === null) return;
        const time = resolvedTime;
        const current = measureRef.current;
        if (current.phase === "idle") {
          setMeasure({
            phase: "placing",
            a: { time, price },
            b: { time, price },
          });
        } else if (current.phase === "placing") {
          setMeasure({
            phase: "done",
            a: current.a,
            b: { time, price },
          });
        } else {
          setMeasure({
            phase: "placing",
            a: { time, price },
            b: { time, price },
          });
        }
      }
    });

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      latestCrosshairParamRef.current = param;
      // Compute the cursor's (time, price) — used by placement preview + magnet
      let cursorTime: number | null = null;
      let cursorPrice: number | null = null;
      if (param.point && candleSeriesRef.current) {
        const p = candleSeriesRef.current.coordinateToPrice(param.point.y);
        if (p !== null && isFinite(p as number)) {
          cursorPrice = p as number;
          if (param.time) {
            cursorTime = Number(param.time);
          } else {
            // Past last candle / before first — extrapolate
            const intervalSec = timeframeToSeconds(
              useChartStore.getState().timeframe,
            );
            cursorTime = xToTime(
              chart,
              param.point.x,
              candlesRef.current,
              intervalSec,
            );
          }
        }
      }

      // Magnet target: when Ctrl is held (or magnet mode is on) + tool active
      // + cursor over chart
      const t = toolRef.current;
      const tracksMagnet =
        t !== "cursor" &&
        t !== "eraser" &&
        cursorTime !== null &&
        cursorPrice !== null;
      const magnetActive = param.sourceEvent?.ctrlKey || useChartStore.getState().magnetMode;
      if (magnetActive && tracksMagnet) {
        const snapped = magnetSnap(cursorPrice!, cursorTime!, candlesRef.current);
        setMagnetTarget({ time: cursorTime!, price: snapped ?? cursorPrice! });
      } else {
        setMagnetTarget((prev) => (prev === null ? prev : null));
      }

      // Measure preview — works for both the measure tool and Shift+Click shortcut
      if (
        (toolRef.current === "measure" || measureRef.current.phase === "placing") &&
        measureRef.current.phase === "placing" &&
        cursorTime !== null &&
        cursorPrice !== null
      ) {
        setMeasure((prev) =>
          prev.phase === "placing"
            ? { ...prev, b: { time: cursorTime!, price: cursorPrice! } }
            : prev,
        );
      }

      // Drawing-tool placement preview (follow cursor between clicks)
      if (cursorTime !== null && cursorPrice !== null) {
        lastCursorRef.current = { time: cursorTime, price: cursorPrice };
        // Apply snap to preview cursor if Ctrl held
        let pc: { time: number; price: number } = { time: cursorTime, price: cursorPrice };
        if (magnetActive) {
          const snapped = magnetSnap(cursorPrice, cursorTime, candlesRef.current);
          if (snapped !== null) pc = { time: cursorTime, price: snapped };
        }
        // Shift held → constrain the preview to horizontal/vertical for line tools.
        // Uses our tracked ref because the chart's move events don't reliably
        // carry the modifier state.
        if (
          shiftHeldRef.current &&
          firstPointRef.current &&
          AXIS_CONSTRAIN_TOOLS.has(toolRef.current) &&
          candleSeriesRef.current
        ) {
          const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
          pc = constrainToAxis(chart, candleSeriesRef.current, candlesRef.current, intervalSec, firstPointRef.current, pc);
        }
        setPreviewState((prev) => (prev ? { ...prev, cursor: pc } : prev));
      }

      if (!param.time || !candleSeriesRef.current) {
        setHover(null);
        return;
      }
      const data = param.seriesData.get(candleSeriesRef.current);
      const vol = volumeSeriesRef.current
        ? param.seriesData.get(volumeSeriesRef.current)
        : null;
      if (data && "open" in data) {
        const o = data.open as number;
        const c = data.close as number;
        setHover({
          o,
          h: data.high as number,
          l: data.low as number,
          c,
          v: vol && "value" in vol ? (vol.value as number) : 0,
          time: Number(param.time),
          pct: o === 0 ? 0 : ((c - o) / o) * 100,
        });
      }
    });

    // Re-render the SVG overlays (drawings, order lines, measure) on pan / zoom
    // so their pixel coords stay in sync with the chart's own canvas. A plain
    // setState here lags visibly behind the chart during a drag: the canvas
    // repaints synchronously/immediately as lightweight-charts handles the
    // pointer event, while a normal React state update is flushed on a later
    // tick. flushSync forces the overlay's re-render (and DOM commit) to
    // happen in the same tick as the chart's own update, eliminating the lag.
    const bumpRenderTick = () => flushSync(() => setRenderTick((t) => t + 1));
    const tsRangeHandler = () => bumpRenderTick();
    chart.timeScale().subscribeVisibleTimeRangeChange(tsRangeHandler);
    // Register viewport applier so undo/redo can restore pan/zoom
    registerViewportApplier((range) => {
      chart.timeScale().setVisibleLogicalRange({ from: range.from, to: range.to });
    });

    // Expose a snapshot capture that composites the chart canvas with the SVG
    // overlays, so UI elsewhere (the header button) can grab the annotated view.
    registerChartCapture(async () => {
      const root = outerRef.current;
      if (!root) return null;
      return composeChartPng(chart, root);
    });

    // Expose the vertical scale so keyboard nudging can move a drawing by whole
    // pixels regardless of the symbol's price magnitude.
    registerPricePerPixel(() => {
      const series = candleSeriesRef.current;
      if (!series) return null;
      const top = series.coordinateToPrice(100);
      const bottom = series.coordinateToPrice(200);
      if (top === null || bottom === null) return null;
      const perPixel = Math.abs((top as number) - (bottom as number)) / 100;
      return perPixel > 0 ? perPixel : null;
    });

    let zoomSaveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastViewport: { from: number; to: number } | null = null;
    const logicalRangeHandler = () => {
      bumpRenderTick();
      // Keep the view shape fresh (span + right offset) while there is real data,
      // so a later symbol change can reproduce the same zoom + scroll position.
      const liveRange = chart.timeScale().getVisibleLogicalRange();
      if (liveRange && liveRange.to > liveRange.from && candlesRef.current.length > 0) {
        viewShapeRef.current = {
          span: liveRange.to - liveRange.from,
          rightOffset: liveRange.to - (candlesRef.current.length - 1),
        };
      }
      if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
      zoomSaveTimer = setTimeout(() => {
        const range = chart.timeScale().getVisibleLogicalRange();
        if (!range || range.to <= range.from) return;
        const bars = Math.round(range.to - range.from);
        if (bars >= 5 && bars <= 5000) {
          useChartStore.getState().setVisibleBars(bars);
        }
        // Push viewport op to unified history (skip during undo/redo application)
        if (!isApplyingHistory) {
          const before = lastViewport ?? { from: range.from, to: range.to };
          const after = { from: range.from, to: range.to };
          if (Math.abs(before.from - after.from) > 0.5 || Math.abs(before.to - after.to) > 0.5) {
            unifiedHistory.push({ kind: "viewport", before, after });
          }
        }
        lastViewport = { from: range.from, to: range.to };
      }, 600);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);

    // ResizeObserver — recompute pane offsets when chart container resizes
    const ro = new ResizeObserver((entries) => {
      requestAnimationFrame(() => recomputePaneOffsets());
      const cr = entries[0]?.contentRect;
      if (cr) setContainerSize({ width: cr.width, height: cr.height });
    });
    ro.observe(containerRef.current);
    // mouseup on the chart container catches pane-separator drag-resizes
    // (ResizeObserver only fires on container resize, not internal pane layout changes)
    const onPaneMouseUp = () =>
      requestAnimationFrame(() => {
        recomputePaneOffsets();
        capturePaneRatios();
        resyncAutoScaleStates();
      });
    containerRef.current.addEventListener("mouseup", onPaneMouseUp);

    // Right-click context menu — "Add alert at [price]"
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!candleSeriesRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const price = candleSeriesRef.current.coordinateToPrice(y);
      if (price === null || isNaN(price as number)) return;
      // Right of the time-scale width = over the price scale (different menu).
      const region: "chart" | "scale" = x > chart.timeScale().width() ? "scale" : "chart";
      setChartContextMenu({ x, y, price: price as number, region });
    };
    containerRef.current.addEventListener("contextmenu", onContextMenu);

    // Touch has no native long-press-to-contextmenu on a canvas, so open the
    // same menu from a pointerdown timer instead — `contextmenu` above never
    // fires on touch.
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStart: { x: number; y: number } | null = null;
    const clearPressTimer = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    };
    const onTouchPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pressStart = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (!candleSeriesRef.current || !containerRef.current || !pressStart) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = pressStart.x - rect.left;
        const y = pressStart.y - rect.top;
        const price = candleSeriesRef.current.coordinateToPrice(y);
        if (price === null || isNaN(price as number)) return;
        const region: "chart" | "scale" = x > chart.timeScale().width() ? "scale" : "chart";
        setChartContextMenu({ x, y, price: price as number, region });
      }, LONG_PRESS_MS);
    };
    const onTouchPointerMove = (e: PointerEvent) => {
      if (!pressStart || !pressTimer) return;
      if (
        Math.abs(e.clientX - pressStart.x) > LONG_PRESS_SLOP ||
        Math.abs(e.clientY - pressStart.y) > LONG_PRESS_SLOP
      ) {
        clearPressTimer();
      }
    };
    containerRef.current.addEventListener("pointerdown", onTouchPointerDown);
    containerRef.current.addEventListener("pointermove", onTouchPointerMove);
    containerRef.current.addEventListener("pointerup", clearPressTimer);
    containerRef.current.addEventListener("pointercancel", clearPressTimer);

    recomputePaneOffsets();
    const initRect = containerRef.current.getBoundingClientRect();
    setContainerSize({ width: initRect.width, height: initRect.height });

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(tsRangeHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);
      ro.disconnect();
      containerRef.current?.removeEventListener("mouseup", onPaneMouseUp);
      containerRef.current?.removeEventListener("contextmenu", onContextMenu);
      clearPressTimer();
      containerRef.current?.removeEventListener("pointerdown", onTouchPointerDown);
      containerRef.current?.removeEventListener("pointermove", onTouchPointerMove);
      containerRef.current?.removeEventListener("pointerup", clearPressTimer);
      containerRef.current?.removeEventListener("pointercancel", clearPressTimer);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      areaSeriesRef.current = null;
      volumeSeriesRef.current = null;
      emaSeriesMapRef.current.clear();
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    };
  }, []);

  // Repaint the axis/font sizing on a breakpoint crossing (rotation/resize) —
  // the create-chart effect above only sets it once, from a synchronous read
  // at mount.
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { fontSize: isMobile ? 11 : 14 },
      rightPriceScale: { minimumWidth: isMobile ? 56 : 0 },
    });
  }, [isMobile]);

  // Switch chart display type (candles / line / area)
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    candleSeriesRef.current.applyOptions({ visible: chartType === "candles" });
    lineSeriesRef.current?.applyOptions({ visible: chartType === "line" });
    areaSeriesRef.current?.applyOptions({ visible: chartType === "area" });
  }, [chartType]);

  // Double-click to open indicator settings
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onDblClick(e: MouseEvent) {
      if (toolRef.current !== "cursor") return;
      const rect = el!.getBoundingClientRect();
      const relY = e.clientY - rect.top;

      const offsets = paneOffsetsRef.current;
      let clickedPane = 0;
      for (let i = 0; i < offsets.length; i++) {
        if (relY >= offsets[i].top && relY < offsets[i].top + offsets[i].height) {
          clickedPane = i;
          break;
        }
      }

      const state = useChartStore.getState();

      if (clickedPane === 0) {
        // Main pane: open EMA settings if click is near a line (within 10px)
        const param = latestCrosshairParamRef.current;
        if (param) {
          for (const [id, series] of emaSeriesMapRef.current) {
            const data = param.seriesData.get(series);
            if (data && "value" in data) {
              const yCoord = series.priceToCoordinate(data.value as number);
              if (yCoord !== null && Math.abs(yCoord - relY) <= 10) {
                state.setSettingsTarget({ kind: "ema", id });
                return;
              }
            }
          }
        }
        // Open Key Levels settings if click is near a key level line (within 8px)
        if (state.indicators.keylevels && !state.hidden.keylevels && candleSeriesRef.current) {
          const levels = computeKeyLevels(candlesRef.current, state.keyLevels);
          for (const lvl of levels) {
            const yCoord = candleSeriesRef.current.priceToCoordinate(lvl.price);
            if (yCoord !== null && Math.abs((yCoord as number) - relY) <= 8) {
              state.setSettingsTarget("keylevels");
              return;
            }
          }
        }
        // Double-click on empty background → collapse/restore the indicator
        // sub-panes, the way TradingView maximizes the price pane.
        //
        // Only when nothing is selected and no placement is in flight: a
        // dblclick that lands while a drawing is selected (or mid-draw) is
        // someone deselecting or finishing a shape, and silently hiding every
        // RSI/MACD pane there would feel like a glitch. The drawing layer
        // clears the selection on its own click, so by the time a *second*
        // click arrives on empty background the selection is already null —
        // hence reading it here rather than trusting the first click.
        //
        // Restricted to the plot area: lightweight-charts owns double-click on
        // the price scale (it resets autoscale there), and hijacking it to
        // collapse every pane instead would be the wrong response entirely.
        const plotWidth = chartRef.current?.timeScale().width() ?? rect.width;
        if (e.clientX - rect.left > plotWidth) return;

        const d = useDrawingsStore.getState();
        if (d.selectedId === null && d.placement.draft === null) {
          state.toggleSubPanesHidden();
        }
        return;
      }

      // Sub-pane: find host indicator
      const idxMap = indicatorPaneIdxRef.current;
      let hostKey: IndicatorKey | null = null;
      for (const k of SUB_PANE_KEYS) {
        if (idxMap[k] === clickedPane && state.indicators[k]) {
          const target = state.indicatorOverlays[k];
          if (!target || target === "own" || !state.indicators[target as IndicatorKey]) {
            hostKey = k;
            break;
          }
        }
      }
      if (!hostKey) return;

      // If ADX is in this pane (possibly as guest), check proximity to its line
      if (idxMap.adx === clickedPane && state.indicators.adx && adxRef.current) {
        const param = latestCrosshairParamRef.current;
        if (param) {
          const data = param.seriesData.get(adxRef.current);
          if (data && "value" in data) {
            const yCoord = adxRef.current.priceToCoordinate(data.value as number);
            if (yCoord !== null && Math.abs(yCoord - relY) <= 10) {
              state.setSettingsTarget("adx");
              return;
            }
          }
        }
      }

      state.setSettingsTarget(hostKey);
    }

    el.addEventListener("dblclick", onDblClick);
    return () => el.removeEventListener("dblclick", onDblClick);
  }, []);

  // Collapse/expand sub-panes (dblclick on empty chart background).
  // setHeight() is clamped to MIN_PANE_HEIGHT=30 inside lightweight-charts.
  // setStretchFactor(0) bypasses that limit → pane renders at the 2px layout minimum.
  // The main pane auto-expands to fill the freed space. No container resize needed.
  //
  // Also re-runs when `indicators` changes, because adding a study while
  // collapsed creates a fresh pane at its default stretch factor — without
  // this it would pop open on its own, contradicting the collapsed state.
  useEffect(() => {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    const wasHidden = prevSubPanesHiddenRef.current;
    prevSubPanesHiddenRef.current = subPanesHidden;

    if (subPanesHidden) {
      panes.forEach((p, i) => {
        if (i === 0) return;
        // Capture only real heights: re-running this while already collapsed
        // would otherwise overwrite every saved factor with 0 and lose them.
        const factor = p.getStretchFactor();
        if (factor > 0) savedPaneHeightsRef.current[i] = factor;
        p.setStretchFactor(0);
      });
    } else if (wasHidden) {
      // Restore only on the collapsed→expanded transition: doing it on every
      // `indicators` change would reset pane heights the user had dragged.
      panes.forEach((p, i) => {
        if (i === 0) return;
        const saved = savedPaneHeightsRef.current[i];
        // Fall back to 1 — the factor the pane-creation code assigns a fresh
        // sub-pane. A pane with nothing saved (collapsed state restored from
        // localStorage, or the study added while collapsed) would otherwise
        // stay at 0 forever: permanently invisible, with no way back.
        p.setStretchFactor(saved && saved > 0 ? saved : 1);
      });
    } else {
      return; // Expanded and staying expanded — leave pane heights alone.
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [subPanesHidden, indicators]);

  // Manage volume — overlay at the bottom of the main pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.volume && !volumeSeriesRef.current) {
      const v = chartRef.current.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: TV_COLORS.textMuted,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        0,
      );
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = v;
      const data = candlesRef.current.map((k) => ({
        time: k.time as UTCTimestamp,
        value: k.volume,
        color: volumeColor(k),
      }));
      v.setData(data);
    } else if (!indicators.volume && volumeSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.volume]);

  // RSI pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.rsi && !rsiRef.current) {
      const paneIndex = 1;
      const r = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.rsi,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r30 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r70 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      rsiRef.current = r;
      rsi30Ref.current = r30;
      rsi70Ref.current = r70;
      try {
        applyPaneLayout(1, 1);
      } catch {}
      updateRSI();
    } else if (!indicators.rsi && rsiRef.current && chartRef.current) {
      chartRef.current.removeSeries(rsiRef.current);
      if (rsi30Ref.current) chartRef.current.removeSeries(rsi30Ref.current);
      if (rsi70Ref.current) chartRef.current.removeSeries(rsi70Ref.current);
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.rsi]);

  // MACD pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.macd && !macdRef.current) {
      const paneIndex = indicators.rsi ? 2 : 1;
      const m = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.macd,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const s = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.yellow,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const h = chartRef.current.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      macdRef.current = m;
      macdSignalRef.current = s;
      macdHistRef.current = h;
      try {
        applyPaneLayout(paneIndex, 1);
      } catch {}
      updateMACD();
    } else if (!indicators.macd && macdRef.current && chartRef.current) {
      if (macdRef.current) chartRef.current.removeSeries(macdRef.current);
      if (macdSignalRef.current) chartRef.current.removeSeries(macdSignalRef.current);
      if (macdHistRef.current) chartRef.current.removeSeries(macdHistRef.current);
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.macd, indicators.rsi]);

  /**
   * Compute pane index for a sub-chart indicator. Fixed display order:
   *   1: RSI, 2: MACD, 3: ADX, 4: Squeeze, 5: VuManChu
   * Each indicator falls into the next available index based on which higher-priority ones are enabled.
   */
  function panelIndexFor(key: SubPaneKey): number {
    const order = SUB_PANE_KEYS;
    const assigned: Record<string, number> = {};
    let idx = 1;
    for (const k of order) {
      const target = indicatorOverlays[k];
      if (target && target !== "own" && indicators[target]) {
        // Share target's pane. If target not yet computed (comes later in order),
        // fall back to current idx — the target will land on the same idx.
        assigned[k] = assigned[target] ?? idx;
      } else {
        assigned[k] = idx;
        if (indicators[k]) idx++;
      }
    }
    return assigned[key];
  }

  // ── ADX pane ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    // Always teardown first so changes to pane assignment (overlays) take effect
    if (adxRef.current) {
      try { chartRef.current.removeSeries(adxRef.current); } catch {}
      adxRef.current = null;
    }
    if (adxPlusDIRef.current) {
      try { chartRef.current.removeSeries(adxPlusDIRef.current); } catch {}
      adxPlusDIRef.current = null;
    }
    if (adxMinusDIRef.current) {
      try { chartRef.current.removeSeries(adxMinusDIRef.current); } catch {}
      adxMinusDIRef.current = null;
    }
    if (adxKeyLevelRef.current) {
      try { chartRef.current.removeSeries(adxKeyLevelRef.current); } catch {}
      adxKeyLevelRef.current = null;
    }
    if (indicators.adx) {
      const paneIndex = panelIndexFor("adx");
      const style = useChartStore.getState().adxStyle;
      // When ADX shares a pane with another indicator, give it its own overlay
      // price scale so it auto-scales independently (ADX: 0-100 vs Squeeze: ±3
      // would leave ADX completely off-screen on a shared scale).
      const adxOverlayTarget = indicatorOverlays.adx;
      const adxIsGuest = !!(adxOverlayTarget && adxOverlayTarget !== "own" && indicators[adxOverlayTarget as IndicatorKey]);
      const adxScaleId = adxIsGuest ? "adx-overlay" : "right";
      adxRef.current = chartRef.current.addSeries(
        LineSeries,
        { color: style.adxColor, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId },
        paneIndex,
      );
      adxPlusDIRef.current = chartRef.current.addSeries(
        LineSeries,
        { color: style.plusDiColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId },
        paneIndex,
      );
      adxMinusDIRef.current = chartRef.current.addSeries(
        LineSeries,
        { color: style.minusDiColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId },
        paneIndex,
      );
      // Key level: constant horizontal line that must not affect price scale auto-fit.
      // autoscaleInfoProvider: () => null excludes it from the auto-scale calculation
      // so the ADX line is not compressed by the constant-value series.
      adxKeyLevelRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: style.keyLevelColor,
          lineWidth: 1,
          lineStyle: 0,
          priceLineVisible: false,
          lastValueVisible: false,
          priceScaleId: adxScaleId,
          autoscaleInfoProvider: () => null,
        },
        paneIndex,
      );
      try {
        applyPaneLayout(paneIndex, 1);
      } catch {}
      updateADX();
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.adx, indicators.rsi, indicators.macd, indicatorOverlays]);

  // ── Squeeze Momentum pane ────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    // Always teardown first so changes in pane assignment (overlays added /
    // removed, RSI/MACD/ADX toggled) move the series to the correct pane.
    if (squeezeHistRef.current) {
      try { chartRef.current.removeSeries(squeezeHistRef.current); } catch {}
      squeezeHistRef.current = null;
    }
    if (squeezeDotsRef.current) {
      try { chartRef.current.removeSeries(squeezeDotsRef.current); } catch {}
      squeezeDotsRef.current = null;
    }
    squeezeDotsMarkersRef.current = null;
    if (indicators.squeeze) {
      const paneIndex = panelIndexFor("squeeze");
      const sqStyle = useChartStore.getState().squeezeStyle;
      // HistogramSeries with per-bar 4 colors (Pine logic) for both modes —
      // the visible result is the colored fill from baseline (0) to value.
      squeezeHistRef.current = chartRef.current.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      squeezeDotsRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: "transparent",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      squeezeDotsMarkersRef.current = createSeriesMarkers(squeezeDotsRef.current);
      try {
        applyPaneLayout(paneIndex, 1);
      } catch {}
      updateSqueeze();
      // When ADX and Squeeze share a pane, enforce the configured visual z-order.
      // Default: ADX (guest) on top. Controlled via paneZOrder[hostKey].
      if (indicators.adx && panelIndexFor("adx") === paneIndex) {
        const hostKey: IndicatorKey = indicatorOverlays.squeeze === "adx" ? "adx" : "squeeze";
        const zOrder = paneZOrder[hostKey];
        // Default: ADX on top (index > squeeze). Explicit order overrides when both keys present.
        const adxShouldBeOnTop =
          !zOrder || !zOrder.includes("adx") || !zOrder.includes("squeeze")
            ? true
            : zOrder.indexOf("adx") > zOrder.indexOf("squeeze");
        if (adxShouldBeOnTop) {
          const adxSt = useChartStore.getState().adxStyle;
          const adxScaleId = "adx-overlay";
          if (adxRef.current) { try { chartRef.current.removeSeries(adxRef.current); } catch {} adxRef.current = null; }
          if (adxPlusDIRef.current) { try { chartRef.current.removeSeries(adxPlusDIRef.current); } catch {} adxPlusDIRef.current = null; }
          if (adxMinusDIRef.current) { try { chartRef.current.removeSeries(adxMinusDIRef.current); } catch {} adxMinusDIRef.current = null; }
          if (adxKeyLevelRef.current) { try { chartRef.current.removeSeries(adxKeyLevelRef.current); } catch {} adxKeyLevelRef.current = null; }
          adxRef.current = chartRef.current.addSeries(LineSeries, { color: adxSt.adxColor, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId }, paneIndex);
          adxPlusDIRef.current = chartRef.current.addSeries(LineSeries, { color: adxSt.plusDiColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId }, paneIndex);
          adxMinusDIRef.current = chartRef.current.addSeries(LineSeries, { color: adxSt.minusDiColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId }, paneIndex);
          adxKeyLevelRef.current = chartRef.current.addSeries(LineSeries, { color: adxSt.keyLevelColor, lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, priceScaleId: adxScaleId, autoscaleInfoProvider: () => null }, paneIndex);
          updateADX();
        }
        // If !adxShouldBeOnTop: Squeeze was added last in this effect → Squeeze already on top
      }
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.squeeze, indicators.rsi, indicators.macd, indicators.adx, indicatorOverlays, paneZOrder]);

  // ── VuManChu Cipher B pane ───────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    // Always teardown VuManChu series first to handle overlay/pane changes
    {
      const vmcRefs = [vmcWt1Ref, vmcWt2Ref, vmcVwapRef, vmcMfiRef, vmcRsiRef, vmcObRef, vmcOsRef, vmcZeroRef];
      for (const r of vmcRefs) {
        if (r.current) {
          try { chartRef.current.removeSeries(r.current); } catch {}
          r.current = null;
        }
      }
      vmcMarkersRef.current = null;
    }
    if (indicators.vumanchu) {
      const paneIndex = panelIndexFor("vumanchu");
      // WT1 (light blue area)
      vmcWt1Ref.current = chartRef.current.addSeries(
        AreaSeries,
        {
          lineColor: TV_STUDY.wt1,
          topColor: "rgba(144, 202, 249, 0.6)",
          bottomColor: "rgba(144, 202, 249, 0.1)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      // WT2 (deeper indigo area)
      vmcWt2Ref.current = chartRef.current.addSeries(
        AreaSeries,
        {
          lineColor: TV_STUDY.wt2,
          topColor: "rgba(91, 98, 229, 0.5)",
          bottomColor: "rgba(91, 98, 229, 0.08)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      // VWAP (wt1 - wt2) — white wash
      vmcVwapRef.current = chartRef.current.addSeries(
        AreaSeries,
        {
          lineColor: "rgba(255, 255, 255, 0.7)",
          topColor: "rgba(255, 255, 255, 0.25)",
          bottomColor: "rgba(255, 255, 255, 0.03)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      // MFI area (green for positive, faded for negative)
      vmcMfiRef.current = chartRef.current.addSeries(
        AreaSeries,
        {
          lineColor: "rgba(62, 225, 69, 0.8)",
          topColor: "rgba(62, 225, 69, 0.55)",
          bottomColor: "rgba(239, 83, 80, 0.4)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      // RSI line (vivid purple)
      vmcRsiRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_STUDY.rsi,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      // OB/OS reference levels
      vmcObRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: "rgba(255, 255, 255, 0.25)",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      vmcOsRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: "rgba(255, 255, 255, 0.25)",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      vmcZeroRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: "rgba(255, 255, 255, 0.4)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      if (vmcWt2Ref.current) {
        vmcMarkersRef.current = createSeriesMarkers(vmcWt2Ref.current);
      }
      try {
        applyPaneLayout(paneIndex, 1.4);
      } catch {}
      updateVumanchu();
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.vumanchu, indicators.rsi, indicators.macd, indicators.adx, indicators.squeeze, indicatorOverlays]);

  // ── OBV pane ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (obvRef.current) {
      try { chartRef.current.removeSeries(obvRef.current); } catch {}
      obvRef.current = null;
    }
    if (indicators.obv) {
      const paneIndex = panelIndexFor("obv");
      obvRef.current = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.obv,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      try {
        applyPaneLayout(paneIndex, 1);
      } catch {}
      updateOBV();
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.obv, indicators.rsi, indicators.macd, indicators.adx, indicators.squeeze, indicators.vumanchu, indicatorOverlays]);

  // ── Bollinger Bands — main-pane overlay ──────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (indicators.bb && !bbMidRef.current) {
      const mk = (color: string) =>
        chart.addSeries(LineSeries, {
          color,
          lineWidth: bollingerStyle.lineWidth,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      bbUpperRef.current = mk(bollingerStyle.upperColor);
      bbMidRef.current = mk(bollingerStyle.basisColor);
      bbLowerRef.current = mk(bollingerStyle.lowerColor);
      updateBB();
    } else if (!indicators.bb && bbMidRef.current) {
      for (const r of [bbUpperRef, bbMidRef, bbLowerRef]) {
        if (r.current) {
          try { chart.removeSeries(r.current); } catch {}
          r.current = null;
        }
      }
      setBbPts([]);
    }
    const visible = indicators.bb && !hidden.bb;
    const width = bollingerStyle.lineWidth;
    bbUpperRef.current?.applyOptions({ color: bollingerStyle.upperColor, lineWidth: width, visible });
    bbLowerRef.current?.applyOptions({ color: bollingerStyle.lowerColor, lineWidth: width, visible });
    bbMidRef.current?.applyOptions({
      color: bollingerStyle.basisColor,
      lineWidth: width,
      visible: visible && bollingerStyle.showBasis,
    });
  }, [indicators.bb, hidden.bb, bollingerStyle]);

  useEffect(() => {
    updateBB();
  }, [config.bbPeriod, config.bbMult, config.bbMaType]);

  // ── VWAP — main-pane overlay with optional deviation bands ───────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (indicators.vwap && !vwapRef.current) {
      vwapRef.current = chart.addSeries(LineSeries, {
        color: vwapStyle.color,
        lineWidth: vwapStyle.lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const band = () =>
        chart.addSeries(LineSeries, {
          color: vwapStyle.bandColor,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      vwapUpperRef.current = band();
      vwapLowerRef.current = band();
      updateVWAP();
    } else if (!indicators.vwap && vwapRef.current) {
      for (const r of [vwapRef, vwapUpperRef, vwapLowerRef]) {
        if (r.current) {
          try { chart.removeSeries(r.current); } catch {}
          r.current = null;
        }
      }
      setVwapPts([]);
    }
    const visible = indicators.vwap && !hidden.vwap;
    vwapRef.current?.applyOptions({ color: vwapStyle.color, lineWidth: vwapStyle.lineWidth, visible });
    for (const r of [vwapUpperRef, vwapLowerRef]) {
      r.current?.applyOptions({ color: vwapStyle.bandColor, visible: visible && vwapStyle.showBands });
    }
  }, [indicators.vwap, hidden.vwap, vwapStyle]);

  useEffect(() => {
    updateVWAP();
  }, [config.vwapAnchor, config.vwapBandMult]);

  // ── Spec-driven oscillator panes (Stoch RSI, %R, ATR, CCI, MFI) ──────────
  // One effect for all five: they differ only in maths and colour, and their
  // pane index depends on which *other* sub-panes are enabled, so any change
  // to the set has to rebuild rather than patch.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const entry of simpleOscRef.current.values()) {
      for (const series of [...entry.lines, ...entry.guides]) {
        try { chart.removeSeries(series); } catch {}
      }
    }
    simpleOscRef.current.clear();

    for (const spec of SIMPLE_OSCILLATORS) {
      if (!indicators[spec.key]) continue;
      const paneIndex = panelIndexFor(spec.key);
      const target = indicatorOverlays[spec.key];
      const isGuest = !!(target && target !== "own" && indicators[target]);
      // A guest gets its own overlay scale: a 0–100 oscillator sharing the
      // pane's scale with, say, ATR in dollars would be flattened off-screen.
      const priceScaleId = isGuest ? `${spec.key}-overlay` : "right";
      const lines = spec.lines.map((l) =>
        chart.addSeries(
          LineSeries,
          {
            color: l.color,
            lineWidth: l.width,
            priceLineVisible: false,
            lastValueVisible: false,
            priceScaleId,
          },
          paneIndex,
        ),
      );
      // Guides stay inside the autoscale (like RSI's 30/70 rails) so a quiet
      // oscillator keeps its familiar fixed frame instead of zooming in on noise.
      const guides = spec.guides.map(() =>
        chart.addSeries(
          LineSeries,
          {
            color: TV_COLORS.textMuted,
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            priceScaleId,
          },
          paneIndex,
        ),
      );
      simpleOscRef.current.set(spec.key, { lines, guides });
      try {
        applyPaneLayout(paneIndex, 1);
      } catch {}
    }
    updateSimpleOscillators();
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, indicatorOverlays]);

  useEffect(() => {
    updateSimpleOscillators();
  }, [
    config.stochRsiLen, config.stochRsiStochLen, config.stochRsiK, config.stochRsiD,
    config.williamsRPeriod, config.atrPeriod, config.cciPeriod, config.mfiPeriod,
  ]);

  // Visibility — eye toggle (hidden state) + enabled state combined.
  // Sub-pane series are also hidden when subPanesHidden (so their legend headers vanish).
  useEffect(() => {
    const v = (key: IndicatorKey) =>
      indicators[key] && !hidden[key] && !(isSubPaneKey(key) && subPanesHidden);
    // EMAs visibility is driven by per-instance `hidden` flag in the sync effect
    if (rsiRef.current) rsiRef.current.applyOptions({ visible: v("rsi") });
    if (rsi30Ref.current) rsi30Ref.current.applyOptions({ visible: v("rsi") });
    if (rsi70Ref.current) rsi70Ref.current.applyOptions({ visible: v("rsi") });
    if (macdRef.current) macdRef.current.applyOptions({ visible: v("macd") });
    if (macdSignalRef.current) macdSignalRef.current.applyOptions({ visible: v("macd") });
    if (macdHistRef.current) macdHistRef.current.applyOptions({ visible: v("macd") });
    if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: v("volume") });
    // ADX pane — respect per-line visibility from adxStyle
    const adxSt = useChartStore.getState().adxStyle;
    if (adxRef.current) adxRef.current.applyOptions({ visible: v("adx") && adxSt.showAdx });
    if (adxPlusDIRef.current) adxPlusDIRef.current.applyOptions({ visible: v("adx") && adxSt.showPlusDi });
    if (adxMinusDIRef.current) adxMinusDIRef.current.applyOptions({ visible: v("adx") && adxSt.showMinusDi });
    if (adxKeyLevelRef.current) adxKeyLevelRef.current.applyOptions({ visible: v("adx") && (adxSt.showKeyLevel ?? true) });
    // Squeeze pane — the histogram provides the price-scale anchor for the SVG
    // overlay; always keep it visible so priceToCoordinate(0) never returns null.
    // The actual show/hide of the histogram colours is handled by the SVG overlay.
    if (squeezeHistRef.current) squeezeHistRef.current.applyOptions({ visible: v("squeeze") });
    if (squeezeDotsRef.current) squeezeDotsRef.current.applyOptions({ visible: v("squeeze") });
    // VuManChu pane
    if (obvRef.current) obvRef.current.applyOptions({ visible: v("obv") });
    // Spec-driven oscillator panes — lines and guides share one visibility.
    for (const [key, entry] of simpleOscRef.current) {
      const on = v(key);
      for (const series of [...entry.lines, ...entry.guides]) series.applyOptions({ visible: on });
    }
    if (vmcWt1Ref.current) vmcWt1Ref.current.applyOptions({ visible: v("vumanchu") });
    if (vmcWt2Ref.current) vmcWt2Ref.current.applyOptions({ visible: v("vumanchu") });
    if (vmcVwapRef.current) vmcVwapRef.current.applyOptions({ visible: v("vumanchu") });
    if (vmcMfiRef.current) vmcMfiRef.current.applyOptions({ visible: v("vumanchu") });
    if (vmcRsiRef.current) vmcRsiRef.current.applyOptions({ visible: v("vumanchu") });
    if (vmcObRef.current) vmcObRef.current.applyOptions({ visible: v("vumanchu") });
    if (vmcOsRef.current) vmcOsRef.current.applyOptions({ visible: v("vumanchu") });
    if (vmcZeroRef.current) vmcZeroRef.current.applyOptions({ visible: v("vumanchu") });
  }, [indicators, hidden, subPanesHidden]);

  // Apply price scale mode/inversion — main candle pane ONLY (uses the
  // candle series's own price scale so sub-pane indicators are unaffected).
  // Log and percentage/indexed-to-100 are mutually exclusive in the library.
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const mode =
      mainPriceScaleMode === "percentage"
        ? PriceScaleMode.Percentage
        : mainPriceScaleMode === "indexed100"
          ? PriceScaleMode.IndexedTo100
          : logScale
            ? PriceScaleMode.Logarithmic
            : PriceScaleMode.Normal;
    candleSeriesRef.current.priceScale().applyOptions({
      mode,
      invertScale: mainPriceScaleInverted,
    });
  }, [logScale, mainPriceScaleMode, mainPriceScaleInverted]);

  // Per-indicator log scale — applies to that indicator's pane price scale
  useEffect(() => {
    const apply = (
      seriesRef: React.RefObject<ISeriesApi<"Line" | "Area" | "Histogram" | "Candlestick"> | null>,
      enabled: boolean,
    ) => {
      if (!seriesRef.current) return;
      seriesRef.current.priceScale().applyOptions({
        mode: enabled ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
    };
    apply(
      rsiRef as unknown as React.RefObject<ISeriesApi<"Line"> | null>,
      !!indicatorLogScale.rsi,
    );
    apply(
      macdRef as unknown as React.RefObject<ISeriesApi<"Line"> | null>,
      !!indicatorLogScale.macd,
    );
    apply(
      adxRef as unknown as React.RefObject<ISeriesApi<"Line"> | null>,
      !!indicatorLogScale.adx,
    );
    apply(
      squeezeHistRef as unknown as React.RefObject<ISeriesApi<"Histogram"> | null>,
      !!indicatorLogScale.squeeze,
    );
    apply(
      vmcWt2Ref as unknown as React.RefObject<ISeriesApi<"Area"> | null>,
      !!indicatorLogScale.vumanchu,
    );
    apply(
      obvRef as unknown as React.RefObject<ISeriesApi<"Line"> | null>,
      !!indicatorLogScale.obv,
    );
    // Spec-driven panes: the first line owns the pane's price scale.
    for (const [key, entry] of simpleOscRef.current) {
      entry.lines[0]?.priceScale().applyOptions({
        mode: indicatorLogScale[key] ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
    }
  }, [indicatorLogScale, indicators]);

  // Apply chart color customization
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: { background: { color: chartColors.bg } },
      grid: {
        vertLines: { color: chartColors.gridLines },
        horzLines: { color: chartColors.gridLines },
      },
    });
    if (candleSeriesRef.current) {
      candleSeriesRef.current.applyOptions({
        upColor: chartColors.bodyUp,
        downColor: chartColors.bodyDown,
        borderUpColor: chartColors.borderUp,
        borderDownColor: chartColors.borderDown,
        wickUpColor: chartColors.wickUp,
        wickDownColor: chartColors.wickDown,
      });
    }
  }, [chartColors]);

  // Sync user EMAs: create/remove series, update color/lineWidth, refresh data
  useEffect(() => {
    if (!chartRef.current) return;
    const map = emaSeriesMapRef.current;
    const wantedIds = new Set(userEMAs.map((e) => e.id));
    // Remove series no longer in the list
    for (const [id, series] of Array.from(map.entries())) {
      if (!wantedIds.has(id)) {
        try {
          chartRef.current.removeSeries(series);
        } catch {}
        map.delete(id);
      }
    }
    // Add or update series for current instances
    for (const e of userEMAs) {
      let series = map.get(e.id);
      if (!series) {
        series = chartRef.current.addSeries(LineSeries, {
          color: e.color,
          lineWidth: (e.lineWidth as 1 | 2 | 3 | 4) ?? 1,
          priceLineVisible: false,
          lastValueVisible: false,
          visible: !e.hidden,
        });
        map.set(e.id, series);
      } else {
        series.applyOptions({
          color: e.color,
          lineWidth: (e.lineWidth as 1 | 2 | 3 | 4) ?? 1,
          visible: !e.hidden,
        });
      }
    }
    updateEMAs();
  }, [userEMAs]);

  useEffect(() => {
    updateRSI();
  }, [config.rsi]);

  useEffect(() => {
    updateMACD();
  }, [config.macdFast, config.macdSlow, config.macdSignal]);

  useEffect(() => {
    updateADX();
  }, [config.adx, config.adxDiLen, config.adxKeyLevel, adxStyle]);

  useEffect(() => {
    updateSqueeze();
  }, [config.squeezeBB, config.squeezeBBMult, config.squeezeKC, config.squeezeKCMult, squeezeStyle]);

  useEffect(() => {
    updateVumanchu();
  }, [
    config.vumanchuChannelLen,
    config.vumanchuAvgLen,
    config.vumanchuMaLen,
    config.vumanchuMfiPeriod,
  ]);

  // Reset selection when symbol changes
  useEffect(() => {
    useDrawingsStore.getState().setSelected(null);
  }, [symbol]);

  // Cursor style when drawing tools are active + reset measure on tool change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor =
        tool === "brush" || tool === "highlighter" ? "crosshair"
        : tool !== "cursor" && tool !== "eraser" ? "crosshair" : "";
    }
    if (tool !== "measure") setMeasure(INITIAL_MEASURE);
    // Reset multi-click placement when switching tools
    firstPointRef.current = null;
    placementPointsRef.current = [];
    setPreviewState(null);
  }, [tool]);

  // Brush / Highlighter — freehand drawing via pointer capture
  useEffect(() => {
    if (tool !== "brush" && tool !== "highlighter") return;
    const container = containerRef.current;
    if (!container) return;

    const isHighlighter = tool === "highlighter";
    let active = false;
    // Raw pixel positions (relative to container) — no time conversion yet
    const rawPx: { x: number; y: number }[] = [];
    let lastX = 0;
    let lastY = 0;

    // Live preview path element injected above the drawings SVG
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:visible");
    const pathEl = document.createElementNS(ns, "path");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", isHighlighter ? TV_PINE.highlighter : TV_PINE.white);
    pathEl.setAttribute("stroke-width", isHighlighter ? "14" : "2");
    pathEl.setAttribute("stroke-linecap", "round");
    pathEl.setAttribute("stroke-linejoin", "round");
    pathEl.setAttribute("opacity", isHighlighter ? "0.35" : "1");
    svg.appendChild(pathEl);
    container.parentElement?.appendChild(svg);

    // Chaikin corner-cutting smoothing — applied on pixel arrays.
    // Each iteration replaces each segment AB with two new points:
    //   Q = 0.75·A + 0.25·B  and  R = 0.25·A + 0.75·B
    // Result after a few iterations: smooth curve through the point cloud.
    function chaikin(pts: { x: number; y: number }[], iters = 3) {
      let r = pts;
      for (let n = 0; n < iters; n++) {
        if (r.length < 3) break;
        const next: { x: number; y: number }[] = [r[0]];
        for (let i = 0; i < r.length - 1; i++) {
          const a = r[i], b = r[i + 1];
          next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
          next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
        }
        next.push(r[r.length - 1]);
        r = next;
      }
      return r;
    }

    // SVG polyline string from pixel array (L commands — smoothing already applied)
    function ptsToD(pixels: { x: number; y: number }[]) {
      if (pixels.length < 2) return "";
      return "M " + pixels[0].x.toFixed(1) + " " + pixels[0].y.toFixed(1) +
        pixels.slice(1).map(p => ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
    }

    function updatePreview() {
      const smoothed = rawPx.length >= 3 ? chaikin(rawPx, 2) : rawPx;
      pathEl.setAttribute("d", ptsToD(smoothed));
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      active = true;
      rawPx.length = 0;
      const rect = container!.getBoundingClientRect();
      lastX = e.clientX - rect.left;
      lastY = e.clientY - rect.top;
      rawPx.push({ x: lastX, y: lastY });
      (container as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!active) return;
      e.preventDefault();
      const rect = container!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - lastX, dy = y - lastY;
      if (dx * dx + dy * dy < 1) return;
      lastX = x; lastY = y;
      rawPx.push({ x, y });
      updatePreview();
    }

    function onPointerUp(e: PointerEvent) {
      if (!active) return;
      active = false;
      e.preventDefault();
      pathEl.setAttribute("d", "");
      if (rawPx.length < 2 || !chartRef.current || !candleSeriesRef.current) return;

      // Apply full Chaikin smoothing on the raw pixel cloud
      const smoothed = rawPx.length >= 3 ? chaikin(rawPx, 3) : rawPx;

      // Convert smoothed pixels → {time, price, logical} — logical for lossless render
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      const points: { time: number; price: number }[] = [];
      const logicals: number[] = [];

      // Compute the pixels-per-bar ratio from two known integer bar positions.
      // This avoids using containerWidth (which includes the price scale and would
      // produce a systematic left-shift because chartAreaWidth < containerWidth).
      const visibleRange = chartRef.current!.timeScale().getVisibleLogicalRange();
      const refLog = Math.round((visibleRange?.from ?? 0) + (visibleRange ? (visibleRange.to - visibleRange.from) / 2 : 0));
      const refX0 = chartRef.current!.timeScale().logicalToCoordinate(refLog as never) as number;
      const refX1 = chartRef.current!.timeScale().logicalToCoordinate((refLog + 1) as never) as number;
      const pxPerBar = (refX1 ?? refX0 + 8) - (refX0 ?? 0);

      for (const { x, y } of smoothed) {
        const price = candleSeriesRef.current!.coordinateToPrice(y);
        if (price === null) continue;
        const time = xToTime(chartRef.current!, x, candlesRef.current, intervalSec);
        if (time === null) continue;
        points.push({ time, price: price as number });
        // Float logical computed from actual bar spacing — no containerWidth dependency
        const logical = refLog + (x - (refX0 ?? 0)) / pxPerBar;
        logicals.push(logical);
      }

      if (points.length >= 2) {
        void drawingsApiRef.current.add({
          id: generateId(),
          kind: tool as "brush" | "highlighter",
          symbol: symbolRef.current,
          points,
          logicals,
          color: isHighlighter ? TV_PINE.highlighter : TV_PINE.white,
          lineWidth: isHighlighter ? 14 : 2,
        });
      }
    }

    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    container.addEventListener("pointermove", onPointerMove, { capture: true });
    container.addEventListener("pointerup", onPointerUp, { capture: true });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      container.removeEventListener("pointermove", onPointerMove, { capture: true });
      container.removeEventListener("pointerup", onPointerUp, { capture: true });
      svg.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Track Ctrl key globally for magnet visual + apply snap to preview
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Meta") {
        setCtrlHeld(e.type === "keydown");
        if (e.type === "keyup") {
          setMagnetTarget(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Window-level mousemove drives the placement preview. We listen on the
  // window (not the container) so that lightweight-charts' internal
  // stopPropagation calls can't suppress our updates.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container || !chartRef.current || !candleSeriesRef.current) return;
      // Only do work when there's an active placement
      if (!firstPointRef.current && placementPointsRef.current.length === 0) return;
      const rect = container.getBoundingClientRect();
      // Skip when cursor is outside the chart
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return;
      }
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rawPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (rawPrice === null || !isFinite(rawPrice as number)) return;
      const intervalSec = timeframeToSeconds(
        useChartStore.getState().timeframe,
      );
      const t = xToTime(chartRef.current, x, candlesRef.current, intervalSec);
      if (t === null) return;
      let price = rawPrice as number;
      const time = t;
      if (e.ctrlKey || e.metaKey || useChartStore.getState().magnetMode) {
        const snapped = magnetSnap(price, time, candlesRef.current);
        if (snapped !== null) price = snapped;
        setMagnetTarget({ time, price });
      }
      lastCursorRef.current = { time, price };
      // Shift → keep the line horizontal/vertical while moving (line tools).
      let cur = { time, price };
      if (
        (shiftHeldRef.current || e.shiftKey) &&
        firstPointRef.current &&
        AXIS_CONSTRAIN_TOOLS.has(toolRef.current)
      ) {
        cur = constrainToAxis(
          chartRef.current,
          candleSeriesRef.current,
          candlesRef.current,
          intervalSec,
          firstPointRef.current,
          cur,
        );
      }
      setPreviewState((prev) => (prev ? { ...prev, cursor: cur } : prev));
    }
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  function updateEMAs() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const emas = useChartStore.getState().userEMAs;
    for (const e of emas) {
      const series = emaSeriesMapRef.current.get(e.id);
      if (!series) continue;
      const data = ema(c, e.period);
      series.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    }
    const lastVol = c.at(-1)?.volume;
    setLastValues((prev) => ({ ...prev, volume: lastVol }));
  }

  function updateOBV() {
    const c = candlesRef.current;
    if (c.length === 0 || !obvRef.current) return;
    const data = obv(c).map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));
    obvRef.current.setData(data);
  }

  function updateBB() {
    const c = candlesRef.current;
    if (c.length === 0 || !bbMidRef.current) return;
    const cfg = configRef.current;
    const pts = bollingerBands(c, cfg.bbPeriod, cfg.bbMult, cfg.bbMaType);
    bbUpperRef.current?.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.upper })));
    bbMidRef.current.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.mid })));
    bbLowerRef.current?.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.lower })));
    setBbPts(pts);
    setLastValues((prev) => ({ ...prev, bb: pts.at(-1)?.mid }));
  }

  function updateVWAP() {
    const c = candlesRef.current;
    if (c.length === 0 || !vwapRef.current) return;
    const cfg = configRef.current;
    const pts = vwapCalc(c, cfg.vwapAnchor, cfg.vwapBandMult);
    // The running sums restart at each anchor rollover, so the value jumps and
    // the plot draws a steep segment across the boundary. That matches Pine's
    // `plot()` — and so TradingView's own VWAP — and it cannot be broken here
    // anyway: a lightweight-charts whitespace point adds a slot on the time
    // scale but the line series still connects straight across it. A real gap
    // would need one series per anchor period.
    const rail = (pick: (p: BandPoint) => number) =>
      pts.map((p) => ({ time: p.time as UTCTimestamp, value: pick(p) }));
    vwapRef.current.setData(rail((p) => p.mid));
    vwapUpperRef.current?.setData(rail((p) => p.upper));
    vwapLowerRef.current?.setData(rail((p) => p.lower));
    setVwapPts(pts);
    setLastValues((prev) => ({ ...prev, vwap: pts.at(-1)?.mid }));
  }

  function updateSimpleOscillators() {
    const c = candlesRef.current;
    if (c.length === 0 || simpleOscRef.current.size === 0) return;
    const cfg = configRef.current;
    const next: Partial<LastValues> = {};
    for (const spec of SIMPLE_OSCILLATORS) {
      const entry = simpleOscRef.current.get(spec.key);
      if (!entry) continue;
      const { times, lines } = spec.compute(c, cfg);
      entry.lines.forEach((series, i) => {
        const values = lines[i] ?? [];
        series.setData(times.map((t, j) => ({ time: t as UTCTimestamp, value: values[j] })));
      });
      if (times.length > 0) {
        const first = times[0] as UTCTimestamp;
        const last = times[times.length - 1] as UTCTimestamp;
        entry.guides.forEach((series, i) => {
          series.setData([
            { time: first, value: spec.guides[i] },
            { time: last, value: spec.guides[i] },
          ]);
        });
      }
      next[spec.key] = lines[0]?.at(-1);
    }
    setLastValues((prev) => ({ ...prev, ...next }));
  }

  function updateRSI() {
    const c = candlesRef.current;
    if (c.length === 0 || !rsiRef.current) return;
    const cfg = configRef.current;
    const data = rsi(c, cfg.rsi).map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));
    rsiRef.current.setData(data);
    if (rsi30Ref.current && data.length > 0)
      rsi30Ref.current.setData([
        { time: data[0].time, value: 30 },
        { time: data[data.length - 1].time, value: 30 },
      ]);
    if (rsi70Ref.current && data.length > 0)
      rsi70Ref.current.setData([
        { time: data[0].time, value: 70 },
        { time: data[data.length - 1].time, value: 70 },
      ]);
    setLastValues((prev) => ({ ...prev, rsi: data.at(-1)?.value }));
  }

  function updateMACD() {
    const c = candlesRef.current;
    if (c.length === 0 || !macdRef.current) return;
    const cfg = configRef.current;
    const m = macd(c, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
    macdRef.current.setData(
      m.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd })),
    );
    macdSignalRef.current?.setData(
      m.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal })),
    );
    macdHistRef.current?.setData(
      m.map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.histogram,
        color: p.histogram >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN,
      })),
    );
    const last = m.at(-1);
    setLastValues((prev) => ({
      ...prev,
      macd: last?.macd,
      macdSignal: last?.signal,
      macdHist: last?.histogram,
    }));
  }

  function updateADX() {
    const c = candlesRef.current;
    if (c.length === 0 || !adxRef.current) return;
    const cfg = configRef.current;
    const style = useChartStore.getState().adxStyle;
    const data = adxCalc(c, { diLen: cfg.adxDiLen, adxLen: cfg.adx });
    adxRef.current.setData(data.map((p) => ({ time: p.time as UTCTimestamp, value: p.adx })));
    const adxEnabled = indicators.adx && !hidden.adx;
    adxRef.current.applyOptions({ color: style.adxColor, lineWidth: style.adxLineWidth ?? 2, visible: style.showAdx && adxEnabled });
    adxPlusDIRef.current?.setData(
      data.map((p) => ({ time: p.time as UTCTimestamp, value: p.plusDI })),
    );
    adxPlusDIRef.current?.applyOptions({ color: style.plusDiColor, lineWidth: style.diLineWidth ?? 1, visible: style.showPlusDi && adxEnabled });
    adxMinusDIRef.current?.setData(
      data.map((p) => ({ time: p.time as UTCTimestamp, value: p.minusDI })),
    );
    adxMinusDIRef.current?.applyOptions({ color: style.minusDiColor, lineWidth: style.diLineWidth ?? 1, visible: style.showMinusDi && adxEnabled });
    if (adxKeyLevelRef.current && data.length > 0) {
      const keyLevelValue = cfg.adxKeyLevel ?? 23;
      adxKeyLevelRef.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: keyLevelValue })),
      );
      adxKeyLevelRef.current.applyOptions({ color: style.keyLevelColor, lineWidth: style.keyLevelLineWidth ?? 1, visible: (style.showKeyLevel ?? true) && adxEnabled });
    }
  }

  function updateSqueeze() {
    const c = candlesRef.current;
    if (c.length === 0 || !squeezeHistRef.current) return;
    const cfg = configRef.current;
    const style = useChartStore.getState().squeezeStyle;
    const pts = squeezeMomentum(c, {
      bbLength: cfg.squeezeBB,
      bbMult: cfg.squeezeBBMult,
      kcLength: cfg.squeezeKC,
      kcMult: cfg.squeezeKCMult,
    });
    const COLORS: Record<string, string> = {
      lime: style.momentumIncPos,
      green: style.momentumDecPos,
      red: style.momentumDecNeg,
      maroon: style.momentumIncNeg,
    };
    // Histogram series stays in place (provides the price-scale anchor and
    // coordinate-to-price mapping for the SVG overlay) but its bars are
    // transparent — the visible rendering happens in <SqueezeOverlay/>,
    // which draws Pine plot.style_area exactly: linear segments between
    // bars, filled to baseline, colors per bar from bcolor logic.
    squeezeHistRef.current.setData(
      pts.map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.momentum,
        color: "rgba(0,0,0,0)",
      })),
    );
    // Keep the histogram visible so its price scale stays valid for priceToCoordinate.
    // The SVG overlay controls what's actually shown to the user.
    squeezeHistRef.current.applyOptions({ visible: true });
    setSqueezePts(pts);
    void COLORS;
    // Zero-line dots: invisible line at 0 + colored markers for squeeze state
    squeezeDotsRef.current?.setData(
      pts.map((p) => ({ time: p.time as UTCTimestamp, value: 0 })),
    );
    if (squeezeDotsMarkersRef.current) {
      const markers: SeriesMarker<Time>[] = !style.showSqueezeDots ? [] : pts.map((p) => ({
        time: p.time as UTCTimestamp,
        position: "inBar",
        shape: "circle",
        size: 0.5,
        color:
          p.state === "on"
            ? style.squeezeOn
            : p.state === "off"
              ? style.squeezeOff
              : style.noSqueeze,
      }));
      squeezeDotsMarkersRef.current.setMarkers(markers);
    }
  }

  function updateVumanchu() {
    const c = candlesRef.current;
    if (c.length === 0 || !vmcWt2Ref.current) return;
    const cfg = configRef.current;
    const pts = vumanchuCalc(c, {
      wtChannelLen: cfg.vumanchuChannelLen,
      wtAverageLen: cfg.vumanchuAvgLen,
      wtMALen: cfg.vumanchuMaLen,
      mfiPeriod: cfg.vumanchuMfiPeriod,
    });
    if (pts.length === 0) return;
    const t0 = pts[0].time as UTCTimestamp;
    const tN = pts[pts.length - 1].time as UTCTimestamp;
    vmcWt1Ref.current?.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.wt1 })));
    vmcWt2Ref.current.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.wt2 })));
    vmcVwapRef.current?.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.vwap })));
    vmcMfiRef.current?.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.mfi })));
    vmcRsiRef.current?.setData(
      pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.rsi - 50 })),
    );
    // Reference levels stretched across the visible range
    vmcObRef.current?.setData([
      { time: t0, value: 60 },
      { time: tN, value: 60 },
    ]);
    vmcOsRef.current?.setData([
      { time: t0, value: -60 },
      { time: tN, value: -60 },
    ]);
    vmcZeroRef.current?.setData([
      { time: t0, value: 0 },
      { time: tN, value: 0 },
    ]);
    // Markers on wt2: crosses, buy/sell, gold, divergences
    if (vmcMarkersRef.current) {
      const markers: SeriesMarker<Time>[] = [];
      for (const p of pts) {
        // Regular cross (small dot)
        if (p.cross && !p.buySignal && !p.sellSignal && !p.goldBuy) {
          markers.push({
            time: p.time as UTCTimestamp,
            position: "inBar",
            shape: "circle",
            size: 0.7,
            color: p.crossUp ? TV_STUDY.crossUp : TV_STUDY.crossDown,
          });
        }
        // Buy / Sell signals (bigger circle)
        if (p.buySignal) {
          markers.push({
            time: p.time as UTCTimestamp,
            position: "belowBar",
            shape: "circle",
            size: 1.4,
            color: TV_STUDY.buy,
            text: "B",
          });
        }
        if (p.sellSignal) {
          markers.push({
            time: p.time as UTCTimestamp,
            position: "aboveBar",
            shape: "circle",
            size: 1.4,
            color: TV_STUDY.sell,
            text: "S",
          });
        }
        // Gold buy
        if (p.goldBuy) {
          markers.push({
            time: p.time as UTCTimestamp,
            position: "belowBar",
            shape: "circle",
            size: 1.6,
            color: TV_STUDY.gold,
            text: "G",
          });
        }
        // Divergences (purple triangles)
        if (p.wtBullDiv || p.rsiBullDiv) {
          markers.push({
            time: p.time as UTCTimestamp,
            position: "belowBar",
            shape: "arrowUp",
            size: 1,
            color: TV_STUDY.crossUp,
          });
        }
        if (p.wtBearDiv || p.rsiBearDiv) {
          markers.push({
            time: p.time as UTCTimestamp,
            position: "aboveBar",
            shape: "arrowDown",
            size: 1,
            color: TV_STUDY.bearDiv,
          });
        }
      }
      vmcMarkersRef.current.setMarkers(markers);
    }
  }

  // Load historical data + subscribe live
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    async function load() {
      try {
        // The current view shape (span + right offset) is tracked continuously in
        // viewShapeRef, so it survives the data wipe below and lets us keep the
        // same zoom + scroll position on the new symbol.
        const shape = viewShapeRef.current;

        // Immediately wipe previous symbol's data so stale candles never linger.
        candlesRef.current = [];
        globalCandlesRef.current = [];
        candleSeriesRef.current?.setData([]);
        lineSeriesRef.current?.setData([]);
        areaSeriesRef.current?.setData([]);
        volumeSeriesRef.current?.setData([]);
        setLastPrice(null);

        const source = resolveSource(symbol);
        const synthetic = source.kind === "synthetic";
        const klines = await fetchCandles(symbol, timeframe, 1000);
        if (cancelled) return;
        candlesRef.current = klines;
        globalCandlesRef.current = klines;
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(
            klines.map((k) => ({
              time: k.time as UTCTimestamp,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            })),
          );
        }
        // Scale the price scale's decimal places to this symbol's price —
        // start from the magnitude-based guess so a sub-cent altcoin doesn't
        // flatten to "0.00" under the library's flat 2-decimal default while
        // the real precision loads, then refine to the exchange's actual
        // tick size once known. That's what makes decimals match TradingView
        // per symbol (e.g. BTC at 1 decimal, ETH at 2, NEAR/AVAX at 3)
        // instead of every symbol ≥$1 flattening to the same 2 decimals.
        if (klines.length > 0) {
          const lastClose = klines[klines.length - 1].close;
          const applyPrecision = (precision: number, minMove: number) => {
            const priceFormat = { type: "price" as const, precision, minMove };
            candleSeriesRef.current?.applyOptions({ priceFormat });
            lineSeriesRef.current?.applyOptions({ priceFormat });
            areaSeriesRef.current?.applyOptions({ priceFormat });
          };
          const guess = priceFormatFor(lastClose);
          applyPrecision(guess.precision, guess.minMove);
          if (source.kind === "binance" || source.kind === "bybit") {
            try {
              const info = await getSymbolInfo(symbol, false, source.kind);
              if (!cancelled && info.tickSize > 0) {
                // Cap the exchange's precision the same way the magnitude guess
                // is capped, or a sub-$1 altcoin quoted to 8 decimals undoes it.
                const exact = exchangePriceFormatFor(lastClose, info.pricePrecision);
                applyPrecision(exact.precision, exact.minMove);
                setSymbolTickSize(info.tickSize);
              }
            } catch {
              // keep the magnitude-based guess
            }
          }
        }
        const closeData = klines.map((k) => ({ time: k.time as UTCTimestamp, value: k.close }));
        lineSeriesRef.current?.setData(closeData);
        areaSeriesRef.current?.setData(closeData);
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(
            klines.map((k) => ({
              time: k.time as UTCTimestamp,
              value: k.volume,
              color: volumeColor(k),
            })),
          );
        }
        updateEMAs();
        updateRSI();
        updateMACD();
        updateADX();
        updateSqueeze();
        updateVumanchu();
        updateOBV();
        updateBB();
        updateVWAP();
        updateSimpleOscillators();
        if (chartRef.current && klines.length > 0) {
          const lastIdx = klines.length - 1;
          if (shape) {
            // Preserve the previous zoom (span) and right-edge offset so the new
            // symbol shows at the same scale/position the user was looking at.
            const to = lastIdx + shape.rightOffset;
            chartRef.current.timeScale().setVisibleLogicalRange({ from: to - shape.span, to });
          } else {
            // First load: show the user's preferred number of recent bars.
            // Bypasses lightweight-charts' default "fit all" which zooms out too far.
            const bars = useChartStore.getState().visibleBars;
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: Math.max(0, lastIdx - bars + 1),
              to: lastIdx + 4,
            });
          }
        }
        // Recompute pane offsets in multiple frames: lightweight-charts needs
        // at least two render cycles after setData() to settle pane heights.
        // The setTimeout backup catches cases where the first frames are still early.
        // Restoring the persisted layout rides the same frames: the sub-panes
        // only exist once the indicator effects have run, so applying earlier
        // (on mount, or before setData) would see a single pane.
        requestAnimationFrame(() => {
          applyPaneRatios();
          recomputePaneOffsets();
          requestAnimationFrame(() => recomputePaneOffsets());
        });
        setTimeout(() => {
          applyPaneRatios();
          recomputePaneOffsets();
        }, 200);

        if (klines.length > 0) {
          const last = klines[klines.length - 1];
          const prev = klines[klines.length - 2] ?? last;
          const lp = {
            value: last.close,
            pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100,
          };
          setLastPrice(lp);
          setCurrentLivePrice(lp.value);
        }

        // Non-Binance sources: poll for fresh data periodically.
        if (source.kind === "yahoo" || source.kind === "fred" || source.kind === "coingecko") {
          const intervalMs =
            source.kind === "yahoo" ? 5000
            : source.kind === "coingecko" ? 60_000
            : 3_600_000; // FRED updates at most daily
          const poll = async () => {
            try {
              const fresh = await fetchCandles(symbol, timeframe, 1000);
              if (cancelled || !candleSeriesRef.current || fresh.length === 0) return;
              candlesRef.current = fresh;
              globalCandlesRef.current = fresh;
              candleSeriesRef.current.setData(
                fresh.map((k) => ({
                  time: k.time as UTCTimestamp,
                  open: k.open,
                  high: k.high,
                  low: k.low,
                  close: k.close,
                })),
              );
              const freshClose = fresh.map((k) => ({ time: k.time as UTCTimestamp, value: k.close }));
              lineSeriesRef.current?.setData(freshClose);
              areaSeriesRef.current?.setData(freshClose);
              if (volumeSeriesRef.current) {
                volumeSeriesRef.current.setData(
                  fresh.map((k) => ({
                    time: k.time as UTCTimestamp,
                    value: k.volume,
                    color: volumeColor(k),
                  })),
                );
              }
              updateEMAs();
              updateRSI();
              updateMACD();
              updateADX();
              updateSqueeze();
              updateVumanchu();
              updateOBV();
              updateBB();
              updateVWAP();
              updateSimpleOscillators();
              const last = fresh[fresh.length - 1];
              const prev = fresh[fresh.length - 2] ?? last;
              const lp2 = {
                value: last.close,
                pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100,
              };
              setLastPrice(lp2);
              setCurrentLivePrice(lp2.value);
            } catch (e) {
              console.error("Polling refresh failed:", e);
            }
          };
          // These sources go through our own /api/* proxies (real Vercel
          // Functions), so keep the timer off while the tab is backgrounded
          // and catch up with one immediate poll on the way back — same
          // treatment as the account poll in useTradingSync.
          let timer: ReturnType<typeof setInterval> | null = null;
          const startPoll = () => {
            if (timer === null) timer = setInterval(() => void poll(), intervalMs);
          };
          const stopPoll = () => {
            if (timer !== null) { clearInterval(timer); timer = null; }
          };
          const onVisibility = () => {
            if (document.hidden) stopPoll();
            else { void poll(); startPoll(); }
          };
          if (!document.hidden) startPoll();
          document.addEventListener("visibilitychange", onVisibility);
          unsub = () => {
            stopPoll();
            document.removeEventListener("visibilitychange", onVisibility);
          };
          return;
        }

        const ws = source.kind === "bybit" ? getBybitWS() : getBinanceWS();
        if (synthetic) {
          // Subscribe to each component, recompute synthetic candle on update
          const symbols = extractSymbols(symbol);
          const lastBySym = new Map<string, Candle>();
          const unsubs = symbols.map((s) =>
            ws.subscribeKline({
              symbol: s,
              interval: timeframe,
              onCandle: (k) => {
                if (useReplayStore.getState().active) return; // frozen during replay
                lastBySym.set(s, k);
                if (lastBySym.size !== symbols.length) return;
                const synth = evaluateCandleAt(symbol, lastBySym);
                if (!synth) return;
                if (!candleSeriesRef.current) return;
                const arr = candlesRef.current;
                const lastCandle = arr[arr.length - 1];
                if (lastCandle && lastCandle.time === synth.time) {
                  arr[arr.length - 1] = synth;
                } else if (!lastCandle || synth.time > lastCandle.time) {
                  arr.push(synth);
                  if (arr.length > 2000) arr.shift();
                } else {
                  return;
                }
                candleSeriesRef.current.update({
                  time: synth.time as UTCTimestamp,
                  open: synth.open,
                  high: synth.high,
                  low: synth.low,
                  close: synth.close,
                });
                lineSeriesRef.current?.update({ time: synth.time as UTCTimestamp, value: synth.close });
                areaSeriesRef.current?.update({ time: synth.time as UTCTimestamp, value: synth.close });
                if (volumeSeriesRef.current) {
                  volumeSeriesRef.current.update({
                    time: synth.time as UTCTimestamp,
                    value: synth.volume,
                    color: volumeColor(synth),
                  });
                }
                updateEMAs();
                updateRSI();
                updateMACD();
                updateADX();
                updateSqueeze();
                updateVumanchu();
              updateOBV();
              updateBB();
              updateVWAP();
              updateSimpleOscillators();
                const prev = arr[arr.length - 2] ?? lastCandle;
                const lp3 = {
                  value: synth.close,
                  pct:
                    prev && prev.close !== 0
                      ? ((synth.close - prev.close) / prev.close) * 100
                      : 0,
                };
                setLastPrice(lp3);
                setCurrentLivePrice(lp3.value);
              },
            }),
          );
          unsub = () => unsubs.forEach((u) => u());
          return;
        }
        unsub = ws.subscribeKline({
          symbol,
          interval: timeframe,
          onCandle: (k) => {
            if (useReplayStore.getState().active) return; // frozen during replay
            if (!candleSeriesRef.current) return;
            const arr = candlesRef.current;
            const lastCandle = arr[arr.length - 1];
            if (lastCandle && lastCandle.time === k.time) {
              arr[arr.length - 1] = k;
            } else if (!lastCandle || k.time > lastCandle.time) {
              arr.push(k);
              if (arr.length > 2000) arr.shift();
            } else {
              return;
            }
            candleSeriesRef.current.update({
              time: k.time as UTCTimestamp,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            });
            lineSeriesRef.current?.update({ time: k.time as UTCTimestamp, value: k.close });
            areaSeriesRef.current?.update({ time: k.time as UTCTimestamp, value: k.close });
            if (volumeSeriesRef.current) {
              volumeSeriesRef.current.update({
                time: k.time as UTCTimestamp,
                value: k.volume,
                color: volumeColor(k),
              });
            }
            updateEMAs();
            updateRSI();
            updateMACD();
            updateADX();
            updateSqueeze();
            updateVumanchu();
            updateOBV();
            updateBB();
            updateVWAP();
            updateSimpleOscillators();
            const prev = arr[arr.length - 2] ?? lastCandle;
            const lp4 = {
              value: k.close,
              pct: prev && prev.close !== 0 ? ((k.close - prev.close) / prev.close) * 100 : 0,
            };
            setLastPrice(lp4);
            setCurrentLivePrice(lp4.value);
          },
        });
      } catch (e) {
        console.error("Failed to load chart data:", e);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [symbol, timeframe]);

  // ── Bar replay ─────────────────────────────────────────────────────────────
  // Push a candle slice through every series + indicator. Indicators read
  // candlesRef, so pointing it at the slice truncates them for free.
  function applyReplayCandles(arr: Candle[]) {
    candlesRef.current = arr;
    globalCandlesRef.current = arr;
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(
        arr.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })),
      );
    }
    const closeData = arr.map((k) => ({ time: k.time as UTCTimestamp, value: k.close }));
    lineSeriesRef.current?.setData(closeData);
    areaSeriesRef.current?.setData(closeData);
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(
        arr.map((k) => ({
          time: k.time as UTCTimestamp,
          value: k.volume,
          color: volumeColor(k),
        })),
      );
    }
    updateEMAs();
    updateRSI();
    updateMACD();
    updateADX();
    updateSqueeze();
    updateVumanchu();
    updateOBV();
    updateBB();
    updateVWAP();
    updateSimpleOscillators();
    if (arr.length) {
      const last = arr[arr.length - 1];
      const prev = arr[arr.length - 2] ?? last;
      setLastPrice({ value: last.close, pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100 });
      setCurrentLivePrice(last.close);
    }
  }

  // Enter: snapshot the full array. Exit: refetch fresh (also catches bars that
  // closed while replay was frozen) and let the live WS resume.
  useEffect(() => {
    if (replayActive) {
      const full = candlesRef.current.slice();
      replayFullRef.current = full;
      useReplayStore.getState().setTotal(full.length);
    } else if (replayFullRef.current.length) {
      replayFullRef.current = [];
      let cancelled = false;
      (async () => {
        try {
          const fresh = await fetchCandles(symbol, timeframe, 1000);
          if (cancelled || useReplayStore.getState().active) return;
          applyReplayCandles(fresh);
        } catch (e) {
          console.error("Replay exit refetch failed:", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActive]);

  // Render the truncated slice as the playhead moves. We subscribe to the replay
  // store imperatively and coalesce work to a single animation frame: holding the
  // step key (or a fast play speed) advances the cursor faster than the chart can
  // redraw, so we always render only the LATEST cursor once per frame — bounding
  // the work regardless of input rate (fixes the renderer OOM crash).
  useEffect(() => {
    if (!replayActive) return;
    let raf = 0;
    let lastRendered = -1;

    const apply = () => {
      raf = 0;
      const { cursorIndex, picking, active } = useReplayStore.getState();
      if (!active || picking) return;
      const full = replayFullRef.current;
      if (!full.length || cursorIndex === lastRendered) return;
      const isFirst = lastRendered === -1; // the initial placement render
      lastRendered = cursorIndex;
      applyReplayCandles(full.slice(0, Math.min(cursorIndex + 1, full.length)));
      // Never move the viewport on the initial pick — later candles just vanish
      // in place. Once advancing, follow the right edge only when the cursor
      // scrolls off (so panning back to inspect stays free).
      if (isFirst) return;
      const ts = chartRef.current?.timeScale();
      const vr = ts?.getVisibleLogicalRange();
      if (ts && vr && cursorIndex > vr.to - 1) {
        const width = vr.to - vr.from;
        ts.setVisibleLogicalRange({ from: cursorIndex - width + 4, to: cursorIndex + 4 });
      }
    };

    const schedule = () => {
      if (raf) return; // one apply per frame — coalesce rapid ticks
      raf = requestAnimationFrame(apply);
    };

    schedule(); // render the starting slice
    const unsub = useReplayStore.subscribe(schedule);
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActive]);

  // Auto-advance while playing (speed = bars per second).
  useEffect(() => {
    if (!replayActive || replayPicking || !replayPlaying) return;
    const id = setInterval(
      () => useReplayStore.getState().stepForward(),
      Math.max(50, Math.round(1000 / replaySpeed)),
    );
    return () => clearInterval(id);
  }, [replayActive, replayPicking, replayPlaying, replaySpeed]);

  // Changing symbol/timeframe cancels replay (the load effect reloads fresh data).
  useEffect(() => {
    if (useReplayStore.getState().active) useReplayStore.getState().exit();
  }, [symbol, timeframe]);

  const greenOrRed = (n: number) =>
    n >= 0 ? "text-tv-green" : "text-tv-red";

  // Helpers for pill rendering
  const isShown = (key: IndicatorKey) =>
    indicators[key] && (key === "volume" || true); // always renderable if enabled
  void isShown;

  // Determine which pane each indicator lives in (based on current layout)
  // Order: RSI > MACD > ADX > Squeeze > VuManChu. Overlaid indicators reuse
  // the target's index instead of taking their own.
  const indicatorPaneIdx: Record<SubPaneKey, number> = (() => {
    const order = SUB_PANE_KEYS;
    const out: Record<string, number> = {};
    let idx = 1;
    for (const k of order) {
      const target = indicatorOverlays[k];
      if (target && target !== "own" && indicators[target]) {
        // Shares the target's pane (computed earlier in the loop)
        out[k] = out[target] ?? idx;
      } else {
        out[k] = idx;
        if (indicators[k]) idx++;
      }
    }
    return out as Record<SubPaneKey, number>;
  })();
  indicatorPaneIdxRef.current = indicatorPaneIdx;
  const rsiPaneIdx = indicatorPaneIdx.rsi;
  const macdPaneIdx = indicatorPaneIdx.macd;
  const adxPaneIdx = indicatorPaneIdx.adx;
  const squeezePaneIdx = indicatorPaneIdx.squeeze;
  const vumanchuPaneIdx = indicatorPaneIdx.vumanchu;

  // ── Overlay drag state — computed at component scope so pointer drag effect can read it ──
  type PaneEntry = { key: IndicatorKey; paneIdx: number; name: string; value?: string };
  const subPaneEntries: PaneEntry[] = (
    [
      { key: "rsi" as IndicatorKey, paneIdx: rsiPaneIdx, name: `RSI ${config.rsi}`, value: lastValues.rsi !== undefined ? lastValues.rsi.toFixed(2) : undefined },
      { key: "macd" as IndicatorKey, paneIdx: macdPaneIdx, name: `MACD ${config.macdFast}, ${config.macdSlow}, ${config.macdSignal}`, value: lastValues.macd !== undefined ? `${lastValues.macd.toFixed(2)} / ${(lastValues.macdSignal ?? 0).toFixed(2)}` : undefined },
      { key: "adx" as IndicatorKey, paneIdx: adxPaneIdx, name: `ADX ${config.adx}` },
      { key: "squeeze" as IndicatorKey, paneIdx: squeezePaneIdx, name: "Squeeze Momentum" },
      { key: "vumanchu" as IndicatorKey, paneIdx: vumanchuPaneIdx, name: "VuManChu Cipher B" },
      { key: "obv" as IndicatorKey, paneIdx: indicatorPaneIdx.obv, name: "OBV" },
      ...SIMPLE_OSCILLATORS.map((spec) => ({
        key: spec.key as IndicatorKey,
        paneIdx: indicatorPaneIdx[spec.key],
        name: spec.name(config),
        value:
          lastValues[spec.key] !== undefined ? spec.format(lastValues[spec.key]!) : undefined,
      })),
    ] as PaneEntry[]
  ).filter((p) => indicators[p.key]);

  const subPaneActiveKeys = new Set(subPaneEntries.map((p) => p.key));
  const ownedSubPanes = subPaneEntries.filter((p) => {
    const target = indicatorOverlays[p.key];
    if (!target || target === "own") return true;
    if (!subPaneActiveKeys.has(target as IndicatorKey)) return true;
    if (indicatorOverlays[target as IndicatorKey] === p.key) return true;
    return false;
  });
  const ownedSubPaneKeySet = new Set(ownedSubPanes.map((p) => p.key));

  // Main-pane pill row (EMAs, Volume, Key Levels) — ordered by mainPaneOrder,
  // with new/unlisted pills appended at the end in their natural order.
  const mainPaneEntries: { key: string; node: React.ReactNode }[] = [
    ...userEMAs.map((e) => ({
      key: `ema:${e.id}`,
      node: (
        <IndicatorPill
          name={`EMA ${e.period}`}
          color={e.color}
          hidden={e.hidden}
          onToggleHide={() => toggleUserEMAHidden(e.id)}
          onSettings={() => setSettingsTarget({ kind: "ema", id: e.id })}
          onRemove={() => removeUserEMA(e.id)}
        />
      ),
    })),
    ...(indicators.volume
      ? [
          {
            key: "volume",
            node: (
              <IndicatorPill
                name="Vol"
                value={lastValues.volume !== undefined ? formatVolume(lastValues.volume) : undefined}
                color={INDICATOR_COLORS.volume}
                hidden={hidden.volume}
                onToggleHide={() => toggleHidden("volume")}
                onSettings={() => setSettingsTarget("volume")}
                onRemove={() => removeIndicator("volume")}
              />
            ),
          },
        ]
      : []),
    ...(indicators.bb
      ? [
          {
            key: "bb",
            node: (
              <IndicatorPill
                name={`BB ${config.bbPeriod}, ${config.bbMult}`}
                value={lastValues.bb !== undefined ? formatPrice(lastValues.bb) : undefined}
                color={bollingerStyle.upperColor}
                hidden={hidden.bb}
                onToggleHide={() => toggleHidden("bb")}
                onSettings={() => setSettingsTarget("bb")}
                onRemove={() => removeIndicator("bb")}
              />
            ),
          },
        ]
      : []),
    ...(indicators.vwap
      ? [
          {
            key: "vwap",
            node: (
              <IndicatorPill
                name="VWAP"
                value={lastValues.vwap !== undefined ? formatPrice(lastValues.vwap) : undefined}
                color={vwapStyle.color}
                hidden={hidden.vwap}
                onToggleHide={() => toggleHidden("vwap")}
                onSettings={() => setSettingsTarget("vwap")}
                onRemove={() => removeIndicator("vwap")}
              />
            ),
          },
        ]
      : []),
    ...(indicators.vrvp
      ? [
          {
            key: "vrvp",
            node: (
              <IndicatorPill
                name="Volume Profile"
                color={volumeProfileCfg.upColor}
                hidden={hidden.vrvp}
                onToggleHide={() => toggleHidden("vrvp")}
                onSettings={() => setSettingsTarget("vrvp")}
                onRemove={() => removeIndicator("vrvp")}
              />
            ),
          },
        ]
      : []),
    ...(indicators.keylevels
      ? [
          {
            key: "keylevels",
            node: (
              <IndicatorPill
                name="Key Levels"
                color={INDICATOR_COLORS.keylevels}
                hidden={hidden.keylevels}
                onToggleHide={() => toggleHidden("keylevels")}
                onSettings={() => setSettingsTarget("keylevels")}
                onRemove={() => removeIndicator("keylevels")}
              />
            ),
          },
        ]
      : []),
  ].sort((a, b) => {
    const ia = mainPaneOrder.indexOf(a.key);
    const ib = mainPaneOrder.indexOf(b.key);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // Pointer-based drag — more reliable than HTML5 DnD which breaks on React re-renders
  useEffect(() => {
    if (!dragKey) return;
    function onPointerUp(e: PointerEvent) {
      const dk = pointerDragRef.current?.key;
      if (!dk) { setDragKey(null); return; }
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        const relY = e.clientY - containerRect.top;
        for (const p of ownedSubPanes) {
          const offset = paneOffsets[p.paneIdx];
          if (!offset) continue;
          if (relY >= offset.top && relY <= offset.top + offset.height) {
            if (dk !== p.key) {
              if (indicatorOverlays[p.key] === dk) setIndicatorOverlay(p.key, "own");
              setIndicatorOverlay(dk, p.key);
            } else if (indicatorOverlays[dk] && indicatorOverlays[dk] !== "own") {
              setIndicatorOverlay(dk, "own");
            }
            break;
          }
        }
      }
      pointerDragRef.current = null;
      setDragKey(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        pointerDragRef.current = null;
        setDragKey(null);
        setMeasure(INITIAL_MEASURE);
      }
    }
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey]);

  // Capture-phase mousedown: handles shift+click for measure regardless of SVG overlay
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    function onShiftCapture(e: MouseEvent) {
      const isPlacing = measureRef.current.phase === "placing";
      if (!e.shiftKey && !isPlacing) return;
      // Don't hijack shift+click while a drawing tool is active — there Shift
      // means "constrain the line to horizontal/vertical", handled by the chart
      // click handler. The quick-measure shortcut only applies from the cursor.
      if (!isPlacing && toolRef.current !== "cursor") return;
      if (!containerRef.current || !chartRef.current || !candleSeriesRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rawPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (rawPrice === null || !isFinite(rawPrice as number)) return;
      const price = rawPrice as number;
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      const time = xToTime(chartRef.current, x, candlesRef.current, intervalSec);
      if (time === null) return;
      if (isPlacing) {
        setMeasure({ phase: "done", a: measureRef.current.a, b: { time, price } });
      } else {
        setMeasure({ phase: "placing", a: { time, price }, b: { time, price } });
      }
      e.stopPropagation();
    }
    outer.addEventListener("mousedown", onShiftCapture, { capture: true });
    return () => outer.removeEventListener("mousedown", onShiftCapture, { capture: true });
  }, []);

  // Capture-phase pointerdown: long/short placement. A plain tap/click (no
  // drag) keeps the old single-click fallback — default risk:reward + zone
  // distance, fixed pixel width. A drag before pointerup instead sets the
  // right edge (timeB) to the release point; stop/target are still sized
  // from the same defaults, only the box's width comes from the drag.
  // Pointer events (not mouse) so this also fires on touch: the chart
  // surface has `touch-action: none` for lightweight-charts' own pan/zoom,
  // which suppresses synthesized compatibility mouse events, so a
  // mousedown-only listener never sees a tap. Mirrors the pointer-capture
  // pattern used by the Brush/Highlighter placement effect above. Runs at
  // capture phase and stops propagation so the chart's own click detection
  // never also fires for this gesture (same trick the shift-capture
  // listener above uses for the measure tool).
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    // Hoisted function declarations below don't inherit the null-narrowing
    // above, so re-bind it once with a non-null type instead of casting at
    // each use.
    const outerEl: HTMLElement = outer;

    /** Set while a placement gesture is in flight, so the effect's own
     *  cleanup can tear its document listeners down on unmount. */
    let endGesture: (() => void) | null = null;

    function computePoint(e: PointerEvent): { time: number; price: number } | null {
      if (!containerRef.current || !chartRef.current || !candleSeriesRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rawPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (rawPrice === null || !isFinite(rawPrice as number)) return null;
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      const time = xToTime(chartRef.current, x, candlesRef.current, intervalSec);
      if (time === null) return null;
      return { time, price: rawPrice as number };
    }

    function defaultTimeB(entryTime: number): number {
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      const tsOpts = chartRef.current?.timeScale().options() as { barSpacing?: number } | undefined;
      const barSpacing = tsOpts?.barSpacing ?? 8;
      const widthBars = Math.max(3, Math.round(144 / barSpacing));
      return entryTime + widthBars * intervalSec;
    }

    /** Default stop/target from the tool's configurable risk:reward + zone
     *  distance (falls back to the historical 1:1 / ~16% of visible range). */
    function defaultLevels(kind: "long" | "short", entryPrice: number): { stop: number; target: number } {
      const defaults = useChartStore.getState().toolDefaults[kind] as
        | { defaultRiskReward?: number; defaultZoneDistancePct?: number }
        | undefined;
      const rr = defaults?.defaultRiskReward && defaults.defaultRiskReward > 0 ? defaults.defaultRiskReward : 1;
      const zonePct = defaults?.defaultZoneDistancePct && defaults.defaultZoneDistancePct > 0 ? defaults.defaultZoneDistancePct : 16;
      const mainPaneH = paneOffsetsRef.current[0]?.height ?? 400;
      const priceTop = candleSeriesRef.current?.coordinateToPrice(10) ?? null;
      const priceBot = candleSeriesRef.current?.coordinateToPrice(mainPaneH - 10) ?? null;
      const visibleRange =
        priceTop !== null && priceBot !== null
          ? Math.abs((priceTop as number) - (priceBot as number))
          : null;
      const riskDist = visibleRange ? visibleRange * (zonePct / 100) : Math.abs(entryPrice) * 0.01 || 1;
      const rewardDist = riskDist * rr;
      return kind === "long"
        ? { stop: entryPrice - riskDist, target: entryPrice + rewardDist }
        : { stop: entryPrice + riskDist, target: entryPrice - rewardDist };
    }

    function finishPlacement(
      kind: "long" | "short",
      entry: { time: number; price: number },
      stop: number,
      target: number,
      timeB: number,
    ) {
      // Style fields (color, widths, ...) still seed the new drawing; the two
      // placement-only defaults above must not leak into the persisted row.
      const styleDefaults = { ...useChartStore.getState().toolDefaults[kind] } as Record<string, unknown>;
      delete styleDefaults.defaultRiskReward;
      delete styleDefaults.defaultZoneDistancePct;
      void drawingsApiRef.current.add({
        id: generateId(),
        kind,
        symbol: symbolRef.current,
        entry: entry.price,
        stop,
        target,
        timeA: entry.time,
        timeB,
        ...styleDefaults,
      } as Parameters<typeof drawingsApiRef.current.add>[0]);
      firstPointRef.current = null;
      setPreviewState(null);
      setToolRef.current("cursor");
    }

    function onPointerDown(e: PointerEvent) {
      if (toolRef.current !== "long" && toolRef.current !== "short") return;
      if (!containerRef.current || !chartRef.current || !candleSeriesRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const plotW = chartRef.current.timeScale().width();
      const mainPaneH = paneOffsetsRef.current[0]?.height ?? 400;
      if (x < 0 || x > plotW || y < 0 || y > mainPaneH) return;
      const entry = computePoint(e);
      if (!entry) return;
      e.preventDefault();
      e.stopPropagation();
      const kind = toolRef.current;
      const { stop, target } = defaultLevels(kind, entry.price);
      // `kind`/`entry`/`stop`/`target` are closed over by the two handlers
      // below, so the gesture needs no component-scoped ref — only the two
      // values that change during it, which are plain locals.
      const startClientX = e.clientX;
      let moved = false;
      setPreviewState({ first: entry, extra: [], cursor: entry });
      outerEl.setPointerCapture(e.pointerId);

      function onMove(ev: PointerEvent) {
        if (Math.abs(ev.clientX - startClientX) > 4) moved = true;
        const cursor = computePoint(ev);
        // Synthesize the preview's cursor price as the precomputed target so
        // PlacementPreview draws the box at its real stop/target distance —
        // only the time (width) tracks the actual drag.
        if (cursor) setPreviewState({ first: entry, extra: [], cursor: { time: cursor.time, price: target } });
      }
      function detach() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        endGesture = null;
      }
      function onUp(ev: PointerEvent) {
        detach();
        let timeB = defaultTimeB(entry!.time);
        if (moved) {
          const release = computePoint(ev);
          if (release && release.time > entry!.time) timeB = release.time;
        }
        finishPlacement(kind, entry!, stop, target, timeB);
      }
      // A touch gesture the browser takes over (or an unmount mid-drag) ends
      // without a pointerup, which would otherwise leave both document
      // listeners — and the closure they pin — alive for the page's lifetime.
      function onCancel() {
        detach();
        setPreviewState(null);
      }
      endGesture = detach;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    }

    outer.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      endGesture?.();
      outer.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, []);

  // OHLC/Vol legend + native crosshair fallback: chart.subscribeCrosshairMove
  // (and the crosshair lines it drives) only fire for mousemoves whose real
  // DOM target lands on the chart's own canvas, but drawing overlays are a
  // sibling that paints on top and becomes the actual target whenever the
  // cursor is over one (e.g. inside a Long/Rectangle/Fib box) — so hovering a
  // candle "under" a drawing would otherwise show neither the legend nor the
  // dotted crosshair. This computes/positions both independently, deferring
  // to the native path (skipping) whenever the canvas itself got the event.
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    function onHoverCapture(e: MouseEvent) {
      if (!containerRef.current || !chartRef.current || !candleSeriesRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return; // native path handles it
      const rect = containerRef.current.getBoundingClientRect();
      if (
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom
      ) {
        return;
      }
      const y = e.clientY - rect.top;
      const rawPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (rawPrice === null) return;
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      const x = e.clientX - rect.left;
      const time = xToTime(chartRef.current, x, candlesRef.current, intervalSec);
      const candles = candlesRef.current;
      if (time === null || candles.length === 0) return;
      const candle = candles.reduce((best, c) =>
        Math.abs(c.time - time) < Math.abs(best.time - time) ? c : best,
      );
      setHover({
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: candle.volume,
        time: candle.time,
        pct: candle.open === 0 ? 0 : ((candle.close - candle.open) / candle.open) * 100,
      });
      // Draws the dotted guide lines + axis labels via the library's own
      // public API, since we can't dispatch a real DOM event onto its canvas.
      // Uses the exact extrapolated cursor time (not the snapped `candle`
      // used for the legend above) — CrosshairMode.Normal follows the cursor
      // exactly rather than snapping to bars, and snapping here pinned the
      // crosshair to the last candle whenever the cursor was past it (e.g.
      // over a drawing that extends into the right-offset margin).
      chartRef.current.setCrosshairPosition(
        rawPrice as number,
        time as UTCTimestamp,
        candleSeriesRef.current,
      );
    }
    function onLeave() {
      setHover(null);
      chartRef.current?.clearCrosshairPosition();
    }
    outer.addEventListener("mousemove", onHoverCapture, { capture: true });
    outer.addEventListener("mouseleave", onLeave);
    return () => {
      outer.removeEventListener("mousemove", onHoverCapture, { capture: true });
      outer.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // Pressing/releasing Shift snaps the placement preview to horizontal/vertical
  // instantly (no mouse move needed), matching TradingView.
  useEffect(() => {
    function onShiftToggle(e: KeyboardEvent) {
      if (e.key !== "Shift") return;
      shiftHeldRef.current = e.shiftKey; // keydown → true, keyup → false
      const first = firstPointRef.current;
      const last = lastCursorRef.current;
      if (
        !first ||
        !last ||
        !AXIS_CONSTRAIN_TOOLS.has(toolRef.current) ||
        !chartRef.current ||
        !candleSeriesRef.current
      ) {
        return;
      }
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      const pc = e.shiftKey
        ? constrainToAxis(chartRef.current, candleSeriesRef.current, candlesRef.current, intervalSec, first, last)
        : last;
      setPreviewState((prev) => (prev ? { ...prev, cursor: pc } : prev));
    }
    window.addEventListener("keydown", onShiftToggle);
    window.addEventListener("keyup", onShiftToggle);
    return () => {
      window.removeEventListener("keydown", onShiftToggle);
      window.removeEventListener("keyup", onShiftToggle);
    };
  }, []);

  let measureRender: React.ReactNode = null;
  if (
    measure.a &&
    measure.b &&
    chartRef.current &&
    candleSeriesRef.current
  ) {
    const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
    const aX = timeToX(chartRef.current, measure.a.time, candlesRef.current, intervalSec);
    const bX = timeToX(chartRef.current, measure.b.time, candlesRef.current, intervalSec);
    const aY = candleSeriesRef.current.priceToCoordinate(measure.a.price);
    const bY = candleSeriesRef.current.priceToCoordinate(measure.b.price);

    if (aX !== null && bX !== null && aY !== null && bY !== null) {
      const priceDiff = measure.b.price - measure.a.price;
      const pctChange =
        measure.a.price === 0 ? 0 : (priceDiff / measure.a.price) * 100;
      const isUp = priceDiff >= 0;
      const start = Math.min(measure.a.time, measure.b.time);
      const end = Math.max(measure.a.time, measure.b.time);
      const inRange = candlesRef.current.filter(
        (c) => c.time >= start && c.time <= end,
      );
      const bars = inRange.length;
      const volume = inRange.reduce((s, c) => s + c.volume, 0);
      const dur = durationLabel(measure.a.time, measure.b.time);

      measureRender = (
        <MeasureOverlay
          aX={aX}
          aY={aY}
          bX={bX}
          bY={bY}
          priceDiff={priceDiff}
          pctChange={pctChange}
          bars={bars}
          volume={volume}
          durationText={dur}
          isUp={isUp}
          isPreview={measure.phase === "placing"}
        />
      );
    }
  }
  void renderTick;

  return (
    <div ref={outerRef} className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <DrawingsLayer
        symbol={symbol}
        chart={chartRef.current}
        candleSeries={candleSeriesRef.current}
        container={containerRef.current}
        width={containerSize.width}
        height={containerSize.height}
        mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
        chartAreaWidth={chartRef.current ? chartRef.current.timeScale().width() : containerSize.width}
        renderTick={renderTick}
      />
      {tradingMode === "live" && (
        <OrderLinesLayer
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          container={containerRef.current}
          width={containerSize.width}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          renderTick={renderTick}
        />
      )}
      {tradingMode === "paper" && (
        <PaperOrderLinesLayer
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          width={containerSize.width}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          renderTick={renderTick}
          symbol={symbol}
        />
      )}

      {indicators.keylevels && !hidden.keylevels && (
        <KeyLevelsOverlay
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          levels={computeKeyLevels(candlesRef.current, keyLevelsCfg)}
          chartAreaWidth={chartRef.current ? chartRef.current.timeScale().width() : containerSize.width}
          chartHeight={containerSize.height}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          textSize={keyLevelsCfg.textSize}
          lineWidth={keyLevelsCfg.lineWidth}
          rightMargin={keyLevelsCfg.distance}
        />
      )}

      {indicators.bb && !hidden.bb && bollingerStyle.showFill && (
        <BandFillOverlay
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          pts={bbPts}
          color={bollingerStyle.fillColor}
          opacity={bollingerStyle.fillOpacity}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          chartAreaWidth={chartRef.current ? chartRef.current.timeScale().width() : containerSize.width}
        />
      )}

      {indicators.vwap && !hidden.vwap && vwapStyle.showBands && vwapStyle.showFill && (
        <BandFillOverlay
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          pts={vwapPts}
          color={vwapStyle.bandColor}
          opacity={vwapStyle.fillOpacity}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          chartAreaWidth={chartRef.current ? chartRef.current.timeScale().width() : containerSize.width}
        />
      )}

      {indicators.vrvp && !hidden.vrvp && (
        <VolumeProfileOverlay
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          candles={candlesRef.current}
          cfg={volumeProfileCfg}
          tickSize={symbolTickSize}
          chartAreaWidth={chartRef.current ? chartRef.current.timeScale().width() : containerSize.width}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          renderTick={renderTick}
        />
      )}

      {indicators.squeeze && !subPanesHidden && paneOffsets[squeezePaneIdx] && paneOffsets[squeezePaneIdx].height > 0 && (
        <SqueezeOverlay
          chart={chartRef.current}
          squeezeSeries={squeezeHistRef.current}
          width={containerSize.width}
          height={containerSize.height}
          paneTop={paneOffsets[squeezePaneIdx].top}
          paneHeight={paneOffsets[squeezePaneIdx].height}
          pts={squeezePts}
          visible={squeezeStyle.showMomentum && !hidden.squeeze}
          colorMap={{
            lime: squeezeStyle.momentumIncPos,
            green: squeezeStyle.momentumDecPos,
            red: squeezeStyle.momentumDecNeg,
            maroon: squeezeStyle.momentumIncNeg,
          }}
          chartAreaWidth={chartRef.current ? chartRef.current.timeScale().width() : containerSize.width}
          screenBlend={
            indicators.adx &&
            (indicatorOverlays.adx === "squeeze" || indicatorOverlays.squeeze === "adx") &&
            (() => {
              const hostKey: IndicatorKey =
                indicatorOverlays.squeeze === "adx" ? "adx" : "squeeze";
              const zOrder = paneZOrder[hostKey];
              return (
                !zOrder ||
                !zOrder.includes("adx") ||
                !zOrder.includes("squeeze") ||
                zOrder.indexOf("adx") > zOrder.indexOf("squeeze")
              );
            })()
          }
        />
      )}
      {previewState && (
        <PlacementPreview
          tool={tool}
          first={previewState.first}
          extra={previewState.extra}
          cursor={previewState.cursor}
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          candles={candlesRef.current}
          intervalSec={timeframeToSeconds(timeframe)}
          width={containerSize.width}
          height={containerSize.height}
        />
      )}
      {ctrlHeld && magnetTarget && (
        <MagnetIndicator
          target={magnetTarget}
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          candles={candlesRef.current}
          intervalSec={timeframeToSeconds(timeframe)}
          width={containerSize.width}
          height={containerSize.height}
        />
      )}
      {measureRender}

      {showBarCountdown && !replayActive && (
        <BarCountdown
          chart={chartRef.current}
          candleSeries={candleSeriesRef.current}
          timeframe={timeframe}
          lastPrice={lastPrice?.value ?? null}
          containerWidth={containerSize.width}
          mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
          renderTick={renderTick}
        />
      )}

      <PositionPriceLabels
        symbol={symbol}
        chart={chartRef.current}
        candleSeries={candleSeriesRef.current}
        containerWidth={containerSize.width}
        mainPaneHeight={paneOffsets[0]?.height ?? containerSize.height}
        renderTick={renderTick}
      />

      <FloatingContextToolbar
        containerSize={containerSize}
        onOpenSettings={() => {
          const id = useDrawingsStore.getState().selectedId;
          if (id) useDrawingsStore.getState().setEditing(id);
        }}
      />

      {/* A / L buttons per pane — positioned at the bottom-right of each
          pane (just above the next pane separator / time axis), offset past
          the right price scale so they don't sit on top of it. */}
      {(() => {
        const scaleWidth = chartRef.current?.priceScale("right").width() ?? 0;
        return paneOffsets.map((p, paneIdx) => {
        // Resolve which indicator owns this pane (for log scale state)
        let key: "main" | IndicatorKey = "main";
        if (paneIdx > 0) {
          for (const k of SUB_PANE_KEYS) {
            if (indicatorPaneIdx[k] === paneIdx && indicators[k]) {
              key = k;
              break;
            }
          }
        }
        const isLog =
          key === "main" ? logScale : !!indicatorLogScale[key as IndicatorKey];
        const toggleLog = () => {
          if (key === "main") {
            useChartStore.getState().setLogScale(!logScale);
          } else {
            useChartStore
              .getState()
              .setIndicatorLogScale(key as IndicatorKey, !isLog);
          }
        };
        const autoFit = () => {
          if (!chartRef.current) return;
          if (key === "main") {
            // Rescale the price axis only — matching TradingView's "Auto"
            // button, this must NOT touch pan/zoom (timeScale) at all.
            candleSeriesRef.current?.priceScale().applyOptions({ autoScale: true });
          } else {
            // Reset just the price scale of the pane to auto
            const seriesByPane = {
              rsi: rsiRef.current,
              macd: macdRef.current,
              adx: adxRef.current,
              squeeze: squeezeHistRef.current,
              vumanchu: vmcWt2Ref.current,
            } as const;
            const s = seriesByPane[key as keyof typeof seriesByPane];
            if (s) {
              s.priceScale().applyOptions({ autoScale: true });
            }
          }
          setAutoScaleOn((prev) => ({ ...prev, [key]: true }));
        };
        const autoScaleActive = autoScaleOn[key] ?? true;
        return (
          <div
            key={paneIdx}
            style={{
              top: p.top + p.height - 26,
              right: scaleWidth + 8,
            }}
            className="pointer-events-auto absolute z-10 flex items-center gap-0.5"
          >
            <button
              onClick={autoFit}
              title="Auto scale"
              className={`flex h-5 w-5 items-center justify-center rounded border border-tv-border text-[10px] font-semibold transition-colors ${
                autoScaleActive
                  ? "bg-tv-blue/20 text-tv-blue-text"
                  : "bg-tv-panel text-tv-text-muted hover:text-tv-text"
              }`}
            >
              A
            </button>
            <button
              onClick={toggleLog}
              title={isLog ? "Switch to linear" : "Switch to logarithmic"}
              className={`flex h-5 w-5 items-center justify-center rounded border border-tv-border text-[10px] font-semibold transition-colors ${
                isLog
                  ? "bg-tv-blue/20 text-tv-blue-text"
                  : "bg-tv-panel text-tv-text-muted hover:text-tv-text"
              }`}
            >
              L
            </button>
          </div>
        );
        });
      })()}

      {/* Top-left of main pane: symbol info + OHLC + Volume pill + EMA pills */}
      <div
        style={{ top: (paneOffsets[0]?.top ?? 0) + 12, left: 12 }}
        className="pointer-events-none absolute z-10 flex flex-col gap-1 text-xs tabular-nums"
      >
        {/* Row 1: symbol · timeframe · Binance + live price inline; OHLC on hover */}
        <div className="flex flex-nowrap items-center gap-x-2 overflow-hidden whitespace-nowrap text-[12px]">
          <span className="font-semibold text-tv-text">{symbol}</span>
          {!isMobile && (
            <>
              <span className="text-tv-text-muted">·</span>
              <span className="font-semibold text-tv-text-muted">{timeframeLabel(timeframe)}</span>
              <span className="text-tv-text-muted">·</span>
              <span className="font-semibold text-tv-text-muted">
                {(() => {
                  const k = resolveSource(symbol).kind;
                  if (k === "fred") return "FRED";
                  if (k === "coingecko") return "CoinGecko";
                  if (k === "yahoo") return "Yahoo";
                  if (k === "synthetic") return "Synthetic";
                  if (k === "bybit") return "Bybit";
                  return "Binance";
                })()}
              </span>
            </>
          )}
          {!hover && lastPrice && (
            <>
              <span className={`font-semibold tabular-nums ${greenOrRed(lastPrice.pct)}`}>
                {formatPrice(lastPrice.value)}
              </span>
              <span className={`text-[10px] ${greenOrRed(lastPrice.pct)}`}>
                {lastPrice.pct >= 0 ? "+" : ""}{lastPrice.pct.toFixed(2)}%
              </span>
            </>
          )}
          {!hover && !lastPrice && (
            <span className="text-[10px] text-tv-text-muted">Loading…</span>
          )}
          {hover && (
            <div className="flex items-center gap-x-2 text-[11px]">
              <span className="text-tv-text-muted">
                O <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.o)}</span>
              </span>
              <span className="text-tv-text-muted">
                H <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.h)}</span>
              </span>
              <span className="text-tv-text-muted">
                L <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.l)}</span>
              </span>
              <span className="text-tv-text-muted">
                C <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.c)}</span>
              </span>
              <span className={greenOrRed(hover.pct)}>
                {hover.pct >= 0 ? "+" : ""}{hover.pct.toFixed(2)}%
              </span>
              <span className="text-tv-text-muted">
                Vol <span className="text-tv-text">{formatVolume(hover.v)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Row 2: quick-trade buttons (only when exchange is connected) */}
        <BuySellOverlay />

        {/* Indicator pills for the main pane (collapsible) */}
        <div className="mt-1 flex flex-col items-start gap-1">
          {!pillsCollapsed && (
            <>
              {mainPaneEntries.map((entry, i) => (
                <div key={entry.key} className="pointer-events-auto flex items-center gap-0.5">
                  {mainPaneEntries.length > 1 && !isMobile && (
                    <div className="flex flex-col">
                      <button
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => {
                          const order = mainPaneEntries.map((e) => e.key);
                          [order[i - 1], order[i]] = [order[i], order[i - 1]];
                          setMainPaneOrder(order);
                        }}
                        className={`flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none ${i === 0 ? "cursor-default text-tv-text-disabled" : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"}`}
                      >
                        ▲
                      </button>
                      <button
                        title="Move down"
                        disabled={i === mainPaneEntries.length - 1}
                        onClick={() => {
                          const order = mainPaneEntries.map((e) => e.key);
                          [order[i], order[i + 1]] = [order[i + 1], order[i]];
                          setMainPaneOrder(order);
                        }}
                        className={`flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none ${i === mainPaneEntries.length - 1 ? "cursor-default text-tv-text-disabled" : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"}`}
                      >
                        ▼
                      </button>
                    </div>
                  )}
                  {entry.node}
                </div>
              ))}
            </>
          )}
          {(userEMAs.length > 0 || indicators.volume || indicators.keylevels || ownedSubPanes.length > 0) && (
            <button
              onClick={() =>
                useChartStore.getState().setPillsCollapsed(!pillsCollapsed)
              }
              title={pillsCollapsed ? "Show indicators" : "Hide indicators"}
              aria-label={pillsCollapsed ? "Show indicators" : "Hide indicators"}
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded bg-tv-panel/95 text-tv-text-muted ring-1 ring-tv-border hover:bg-tv-panel-hover hover:text-tv-text"
            >
              <ChevronUp
                className={`h-3.5 w-3.5 transition-transform ${
                  pillsCollapsed ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {/* ── Sub-pane indicator pills with drag-to-overlay ─────────────────── */}
      {/* Drop zones — always in the DOM. Visible/active only while dragging.
          Skipped entirely while collapsed: a hidden pane is still ~2px tall,
          so its zone would sit as an invisible sliver over the price pane and
          swallow drops meant for the chart. */}
      {!subPanesHidden && ownedSubPanes.map((p) => {
        const offset = paneOffsets[p.paneIdx];
        if (!offset) return null;
        const isSource = !!dragKey && (dragKey === p.key || indicatorOverlays[dragKey] === p.key);
        const active = dragKey !== null;
        return (
          <div
            key={`drop-${p.key}`}
            style={{ top: offset.top, height: offset.height, left: 0, right: 0 }}
            className={`absolute z-20 border-2 transition-all duration-150 ${
              active
                ? isSource
                  ? "border-yellow-400/60 bg-yellow-400/5"
                  : "border-blue-400/60 bg-blue-400/10"
                : "pointer-events-none border-transparent bg-transparent"
            }`}
          >
            {active && (
              <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white/70">
                {isSource ? "Release to detach" : `Drop to overlay on ${p.name}`}
              </span>
            )}
          </div>
        );
      })}

      {/* Pills for each owned pane. Collapsed sub-panes are ~2px tall, so
          their pills would otherwise pile up as orphaned labels floating over
          the price pane instead of disappearing with the pane they name. */}
      {!pillsCollapsed && !subPanesHidden && ownedSubPanes.map((p) => {
        const offset = paneOffsets[p.paneIdx];
        if (!offset) return null;
        const guests = subPaneEntries.filter(
          (e) => indicatorOverlays[e.key] === p.key && !ownedSubPaneKeySet.has(e.key),
        );
        const allPaneEntries = [p, ...guests];
        const allPaneKeys = allPaneEntries.map((e) => e.key);
        const hasMultiple = allPaneKeys.length > 1;
        const savedOrder = paneZOrder[p.key];
        const effectiveZOrder =
          savedOrder && allPaneKeys.every((k) => savedOrder.includes(k))
            ? savedOrder
            : allPaneKeys; // default: host first, guests on top
        return (
          <div
            key={p.key}
            style={{ top: offset.top + 6, left: 12 }}
            className="pointer-events-none absolute z-10 flex flex-col items-start gap-1"
          >
            {allPaneEntries.map((entry) => {
              const isGuest = indicatorOverlays[entry.key] && indicatorOverlays[entry.key] !== "own";
              const posInOrder = effectiveZOrder.indexOf(entry.key);
              const isOnTop = posInOrder === effectiveZOrder.length - 1;
              const isOnBottom = posInOrder === 0;
              return (
                <div key={entry.key} className="pointer-events-auto flex items-center gap-0.5">
                  {/* Drag handle — uses pointer events (not HTML5 DnD) for reliability */}
                  <div
                    className={`cursor-grab select-none px-0.5 text-xs hover:text-white/60 active:cursor-grabbing ${dragKey === entry.key ? "text-white/80" : "text-white/40"}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      pointerDragRef.current = { key: entry.key };
                      setDragKey(entry.key);
                    }}
                  >
                    ⠿
                  </div>
                  {isGuest && (
                    <button
                      title="Detach to own pane"
                      className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-white/40 hover:bg-white/10 hover:text-white/80"
                      onClick={() => setIndicatorOverlay(entry.key, "own")}
                    >
                      ⊞
                    </button>
                  )}
                  {/* Visual order buttons — only when pane has multiple indicators */}
                  {hasMultiple && (
                    <div className="flex flex-col">
                      <button
                        title="Bring to front"
                        disabled={isOnTop}
                        onClick={() => {
                          const newOrder = [...effectiveZOrder.filter((k) => k !== entry.key), entry.key];
                          setPaneZOrder(p.key, newOrder);
                        }}
                        className={`flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none ${isOnTop ? "cursor-default text-white/15" : "text-white/40 hover:bg-white/10 hover:text-white/80"}`}
                      >
                        ▲
                      </button>
                      <button
                        title="Send to back"
                        disabled={isOnBottom}
                        onClick={() => {
                          const newOrder = [entry.key, ...effectiveZOrder.filter((k) => k !== entry.key)];
                          setPaneZOrder(p.key, newOrder);
                        }}
                        className={`flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none ${isOnBottom ? "cursor-default text-white/15" : "text-white/40 hover:bg-white/10 hover:text-white/80"}`}
                      >
                        ▼
                      </button>
                    </div>
                  )}
                  <IndicatorPill
                    name={entry.name}
                    value={entry.value}
                    color={INDICATOR_COLORS[entry.key]}
                    hidden={hidden[entry.key]}
                    onToggleHide={() => toggleHidden(entry.key)}
                    onSettings={() => setSettingsTarget(entry.key)}
                    onRemove={() => removeIndicator(entry.key)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Bar-replay transport controls (only rendered once active — the entry
          trigger lives in the Header, next to Alert) */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2">
        <ReplayToolbar />
      </div>

      {/* Chart right-click context menu */}
      {chartContextMenu && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="absolute inset-0 z-40"
            onMouseDown={() => setChartContextMenu(null)}
          />
          <div
            style={{
              top: Math.max(
                8,
                Math.min(
                  chartContextMenu.y,
                  containerSize.height - (chartContextMenu.region === "scale" ? 260 : 180),
                ),
              ),
              left: Math.max(8, Math.min(chartContextMenu.x, containerSize.width - 232)),
            }}
            className="absolute z-50 min-w-56 overflow-hidden rounded border border-tv-border bg-tv-panel py-1 shadow-2xl"
          >
            {chartContextMenu.region === "chart" && (
              <>
                <button
                  onMouseDown={() => {
                    openAlertDialog(chartContextMenu.price);
                    setChartContextMenu(null);
                  }}
                  className={MENU_ITEM_CLS}
                >
                  <Bell className="h-3.5 w-3.5 shrink-0 text-tv-yellow" />
                  <span>
                    Add alert on{" "}
                    <span className="font-medium">{symbol}</span> at{" "}
                    <span className="font-medium">{formatPrice(chartContextMenu.price)}</span>
                  </span>
                </button>
                <div className="my-1 h-px bg-tv-border" />
              </>
            )}

            <button
              onMouseDown={() => {
                if (chartContextMenu.region === "scale") {
                  // Price-scale-only auto-fit — rescales the Y axis to the
                  // currently visible candles without touching pan/zoom.
                  candleSeriesRef.current?.priceScale().applyOptions({ autoScale: true });
                } else {
                  chartRef.current?.timeScale().fitContent();
                  candleSeriesRef.current?.priceScale().applyOptions({ autoScale: true });
                }
                setChartContextMenu(null);
              }}
              className={MENU_ITEM_CLS}
            >
              <Maximize2 className="h-3.5 w-3.5 shrink-0 text-tv-text-muted" />
              <span>{chartContextMenu.region === "scale" ? "Auto (fit data)" : "Fit chart to data"}</span>
            </button>
            <button
              onMouseDown={() => {
                useChartStore.getState().setLogScale(!logScale);
                setChartContextMenu(null);
              }}
              className={MENU_ITEM_CLS}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] font-bold text-tv-text-muted">
                L
              </span>
              <span>{logScale ? "Switch to linear scale" : "Switch to logarithmic scale"}</span>
            </button>

            {chartContextMenu.region === "scale" && (
              <>
                <button
                  onMouseDown={() => {
                    useChartStore
                      .getState()
                      .setMainPriceScaleMode(
                        mainPriceScaleMode === "percentage" ? "normal" : "percentage",
                      );
                    setChartContextMenu(null);
                  }}
                  className={MENU_ITEM_CLS}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] font-bold text-tv-text-muted">
                    %
                  </span>
                  <span>{mainPriceScaleMode === "percentage" ? "Switch to regular scale" : "Percentage scale"}</span>
                </button>
                <button
                  onMouseDown={() => {
                    useChartStore
                      .getState()
                      .setMainPriceScaleMode(
                        mainPriceScaleMode === "indexed100" ? "normal" : "indexed100",
                      );
                    setChartContextMenu(null);
                  }}
                  className={MENU_ITEM_CLS}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[9px] font-bold text-tv-text-muted">
                    100
                  </span>
                  <span>{mainPriceScaleMode === "indexed100" ? "Switch to regular scale" : "Indexed to 100"}</span>
                </button>
                <button
                  onMouseDown={() => {
                    useChartStore.getState().toggleMainPriceScaleInverted();
                    setChartContextMenu(null);
                  }}
                  className={MENU_ITEM_CLS}
                >
                  <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-tv-text-muted" />
                  <span>{mainPriceScaleInverted ? "Un-invert scale" : "Invert scale"}</span>
                </button>
              </>
            )}

            {chartContextMenu.region === "chart" && (
              <>
                <div className="my-1 h-px bg-tv-border" />
                <button
                  onMouseDown={() => {
                    useChartStore.getState().setChartSettingsOpen(true);
                    setChartContextMenu(null);
                  }}
                  className={MENU_ITEM_CLS}
                >
                  <Settings2 className="h-3.5 w-3.5 shrink-0 text-tv-text-muted" />
                  <span>Chart settings…</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
