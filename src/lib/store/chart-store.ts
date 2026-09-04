"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Timeframe } from "@/lib/binance/types";
import { DEFAULT_FLAG_COLOR } from "@/lib/watchlist/flags";
import { unifiedHistory, isApplyingHistory, withoutHistory } from "@/lib/history";
import type { ChartStateSnapshot } from "@/lib/history";
import type { WatchSort } from "@/lib/watchlist/sort";

export type IndicatorKey =
  | "rsi"
  | "macd"
  | "volume"
  | "adx"
  | "squeeze"
  | "vumanchu"
  | "obv"
  | "keylevels"
  | "bb"
  | "vwap"
  | "vrvp"
  | "stochrsi"
  | "williamsr"
  | "atr"
  | "cci"
  | "mfi";

/**
 * Indicators that live in their own sub-pane below the price pane, in display
 * order. Everything else is a main-pane overlay. Kept here rather than inline
 * in `PriceChart` because the pane-index math, the visibility effect and the
 * "collapse all sub-panes" toggle each need the same list, and they drifted
 * apart when they were three separate literals.
 */
export const SUB_PANE_KEYS = [
  "rsi",
  "macd",
  "adx",
  "squeeze",
  "vumanchu",
  "obv",
  "stochrsi",
  "williamsr",
  "atr",
  "cci",
  "mfi",
] as const satisfies readonly IndicatorKey[];

export type SubPaneKey = (typeof SUB_PANE_KEYS)[number];

export function isSubPaneKey(key: IndicatorKey): key is SubPaneKey {
  return (SUB_PANE_KEYS as readonly IndicatorKey[]).includes(key);
}

export type DrawingTool =
  | "cursor"
  | "measure"
  | "eraser"
  | "hline"
  | "vline"
  | "trendline"
  | "ray"
  | "hray"
  | "parallel-channel"
  | "fib-retracement"
  | "price-range"
  | "date-range"
  | "long"
  | "short"
  | "brush"
  | "highlighter"
  | "rectangle"
  | "arrow"
  | "text"
  | "fib-extension"
  | "pitchfork"
  | "callout"
  | "xabcd";

export interface IndicatorConfig {
  rsi: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  adx: number;
  adxDiLen: number;
  adxKeyLevel: number;
  squeezeBB: number;
  squeezeBBMult: number;
  squeezeKC: number;
  squeezeKCMult: number;
  vumanchuChannelLen: number;
  vumanchuAvgLen: number;
  vumanchuMaLen: number;
  vumanchuMfiPeriod: number;
  bbPeriod: number;
  bbMult: number;
  bbMaType: "SMA" | "EMA";
  vwapAnchor: "session" | "week" | "month" | "year";
  vwapBandMult: number;
  stochRsiLen: number;
  stochRsiStochLen: number;
  stochRsiK: number;
  stochRsiD: number;
  williamsRPeriod: number;
  atrPeriod: number;
  cciPeriod: number;
  mfiPeriod: number;
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  rsi: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  adx: 14,
  adxDiLen: 14,
  adxKeyLevel: 23,
  squeezeBB: 20,
  squeezeBBMult: 2,
  squeezeKC: 20,
  squeezeKCMult: 1.5,
  vumanchuChannelLen: 9,
  vumanchuAvgLen: 12,
  vumanchuMaLen: 3,
  vumanchuMfiPeriod: 60,
  bbPeriod: 20,
  bbMult: 2,
  bbMaType: "SMA",
  vwapAnchor: "session",
  vwapBandMult: 1,
  stochRsiLen: 14,
  stochRsiStochLen: 14,
  stochRsiK: 3,
  stochRsiD: 3,
  williamsRPeriod: 14,
  atrPeriod: 14,
  cciPeriod: 20,
  mfiPeriod: 14,
};

export interface KeyLevelsConfig {
  distance: number;          // bars to extend lines to the right
  textSize: "Small" | "Medium" | "Large";
  lineWidth: "Small" | "Medium" | "Large";
  alwaysShow: boolean;

  daily:     { open: boolean; prevOpen: boolean; prevHL: boolean; prevMid: boolean; color: string };
  monday:    { range: boolean; mid: boolean; color: string };
  weekly:    { open: boolean; prevOpen: boolean; prevHL: boolean; prevMid: boolean; color: string };
  monthly:   { open: boolean; prevOpen: boolean; prevHL: boolean; prevMid: boolean; color: string };
  quarterly: { open: boolean; prevOpen: boolean; prevHL: boolean; prevMid: boolean; color: string };
  yearly:    { open: boolean; prevOpen: boolean; currHL: boolean; currMid: boolean; color: string };
  fourHour:  { open: boolean; prevHL: boolean; prevMid: boolean; color: string };
}

export const DEFAULT_KEY_LEVELS: KeyLevelsConfig = {
  distance: 20,
  textSize: "Medium",
  lineWidth: "Small",
  alwaysShow: false,
  daily:     { open: true,  prevOpen: false, prevHL: false, prevMid: false, color: "#08bcd4" },
  monday:    { range: true,  mid: true,                                     color: "#ffffff" },
  weekly:    { open: true,  prevOpen: true,  prevHL: true,  prevMid: true,  color: "#ffeb3b" },
  monthly:   { open: true,  prevOpen: true,  prevHL: true,  prevMid: true,  color: "#089981" },
  quarterly: { open: true,  prevOpen: false, prevHL: false, prevMid: false, color: "#ffa726" },
  yearly:    { open: true,  prevOpen: false, currHL: false, currMid: false, color: "#f23645" },
  fourHour:  { open: false,                  prevHL: false, prevMid: false, color: "#ab47bc" },
};

export interface AdxStyle {
  adxColor: string;
  plusDiColor: string;
  minusDiColor: string;
  keyLevelColor: string;
  showAdx: boolean;
  showPlusDi: boolean;
  showMinusDi: boolean;
  showKeyLevel: boolean;
  adxLineWidth: 1 | 2 | 3 | 4;
  diLineWidth: 1 | 2 | 3 | 4;
  keyLevelLineWidth: 1 | 2 | 3 | 4;
}

export const DEFAULT_ADX_STYLE: AdxStyle = {
  adxColor: "#8c8c8c",
  plusDiColor: "#089981",
  minusDiColor: "#f23645",
  keyLevelColor: "#ffffff",
  showAdx: true,
  showPlusDi: true,
  showMinusDi: true,
  showKeyLevel: true,
  adxLineWidth: 2,
  diLineWidth: 1,
  keyLevelLineWidth: 1,
};

export const INDICATOR_COLORS: Record<IndicatorKey, string> = {
  rsi: "#ab47bc",
  macd: "#2962ff",
  volume: "#8c8c8c",
  adx: "#ff9800",
  squeeze: "#2962ff",
  vumanchu: "#4994ec",
  obv: "#ff9800",
  keylevels: "#08bcd4",
  bb: "#2962ff",
  vwap: "#00bcd4",
  vrvp: "#2962ff",
  stochrsi: "#2962ff",
  williamsr: "#ab47bc",
  atr: "#ff9800",
  cci: "#089981",
  mfi: "#42a5f5",
};

/** Bollinger Bands style — colours, widths and the optional band fill. */
export interface BollingerStyle {
  basisColor: string;
  upperColor: string;
  lowerColor: string;
  lineWidth: 1 | 2 | 3 | 4;
  showBasis: boolean;
  /** Translucent fill between the bands, as TradingView draws it. */
  showFill: boolean;
  fillColor: string;
  fillOpacity: number;
}

export const DEFAULT_BOLLINGER_STYLE: BollingerStyle = {
  basisColor: "#ff6d00",
  upperColor: "#2962ff",
  lowerColor: "#2962ff",
  lineWidth: 1,
  showBasis: true,
  showFill: true,
  fillColor: "#2962ff",
  fillOpacity: 0.08,
};

/** VWAP style — the line plus its optional deviation bands. */
export interface VwapStyle {
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  showBands: boolean;
  bandColor: string;
  showFill: boolean;
  fillOpacity: number;
}

export const DEFAULT_VWAP_STYLE: VwapStyle = {
  // Cyan rather than TradingView's blue: Bollinger's rails already default to
  // blue here, and the two are both main-pane overlays people run together.
  color: "#00bcd4",
  lineWidth: 2,
  showBands: false,
  bandColor: "#8c8c8c",
  showFill: false,
  fillOpacity: 0.06,
};

/**
 * Volume Profile (Visible Range) — mirrors TradingView's own settings panel,
 * split the same way: Inputs decide *what* is measured, Style decides how it
 * is drawn.
 */
export interface VolumeProfileConfig {
  // Inputs
  rowsLayout: "rows" | "ticks";
  rowSize: number;
  volumeMode: "updown" | "total" | "delta";
  valueAreaPct: number;
  placement: "right" | "left";
  extendPocRight: boolean;
  showDevelopingPoc: boolean;
  // Style
  upColor: string;
  downColor: string;
  valueAreaUpColor: string;
  valueAreaDownColor: string;
  totalColor: string;
  pocColor: string;
  pocLineWidth: 1 | 2 | 3 | 4;
  developingPocColor: string;
  /** Histogram width as a percentage of the plot area. */
  widthPct: number;
  /** Opacity applied to rows outside the value area. */
  opacity: number;
  showValues: boolean;
}

export const DEFAULT_VOLUME_PROFILE: VolumeProfileConfig = {
  rowsLayout: "rows",
  rowSize: 24,
  volumeMode: "updown",
  valueAreaPct: 70,
  placement: "right",
  extendPocRight: true,
  showDevelopingPoc: false,
  upColor: "#089981",
  downColor: "#f23645",
  valueAreaUpColor: "#089981",
  valueAreaDownColor: "#f23645",
  totalColor: "#2962ff",
  pocColor: "#ff0000",
  pocLineWidth: 1,
  developingPocColor: "#ffeb3b",
  widthPct: 30,
  opacity: 0.45,
  showValues: false,
};

/** A user-added EMA instance. Multiple can coexist. */
export interface UserEMA {
  id: string;
  period: number;
  color: string;
  lineWidth: number;
  hidden: boolean;
}

const EMA_PALETTE = [
  "#ff9800",
  "#2962ff",
  "#ab47bc",
  "#089981",
  "#f23645",
  "#42a5f5",
  "#ec407a",
  "#ffee58",
];

export interface ChartColors {
  bg: string;
  gridLines: string;
  /** Candle body (filled rectangle) */
  bodyUp: string;
  bodyDown: string;
  /** Candle border (outline of the body) */
  borderUp: string;
  borderDown: string;
  /** Candle wick (high/low extension lines) */
  wickUp: string;
  wickDown: string;
}

export const DEFAULT_CHART_COLORS: ChartColors = {
  bg: "#0f0f0f",
  gridLines: "#2a2a2a",
  bodyUp: "#089981",
  bodyDown: "#f23645",
  borderUp: "#089981",
  borderDown: "#f23645",
  wickUp: "#089981",
  wickDown: "#f23645",
};

/** Per-indicator style overrides (colors, visibility) */
export interface SqueezeStyle {
  /** Momentum histogram colors (Pine: lime/green/red/maroon) */
  momentumIncPos: string;
  momentumDecPos: string;
  momentumIncNeg: string;
  momentumDecNeg: string;
  /** Squeeze state dots (on/off/no-squeeze) */
  squeezeOn: string;
  squeezeOff: string;
  noSqueeze: string;
  /** Visibility toggles */
  showMomentum: boolean;
  showSqueezeDots: boolean;
}

export const DEFAULT_SQUEEZE_STYLE: SqueezeStyle = {
  // Pine-exact colors from the Rolgui Squeeze indicator:
  //   color.rgb(46, 245, 39)   → lime  (val>0 and val>prev)
  //   color.rgb(16, 120, 13)   → green (val>0 and val<=prev)
  //   color.rgb(217, 6, 6)     → red   (val<0 and val<prev)
  //   color.rgb(98, 0, 0)      → maroon(val<0 and val>=prev)
  momentumIncPos: "#2ef527",
  momentumDecPos: "#10780d",
  momentumIncNeg: "#620000",
  momentumDecNeg: "#d90606",
  // Pine paints the squeeze-on dot black, which was already invisible on the
  // old near-black background and is invisible on #0f0f0f too. Amber instead:
  // it reads at a 0.5-size marker, and it collides with neither the gray
  // "released" dot, the blue "no squeeze" one, nor the red/green momentum bars
  // behind it. This does shift the indicator's semantics slightly — "coiled"
  // now reads as a caution color rather than as absence — but a dot nobody can
  // see carries no semantics at all.
  squeezeOn: "#ff9800",
  squeezeOff: "#8c8c8c",
  noSqueeze: "#2962ff",
  showMomentum: true,
  showSqueezeDots: true,
};

export const DEFAULT_WATCHLIST = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
];

/** Either a symbol entry or a section label inside a watchlist. */
/** A named, saveable style preset for a drawing kind (see `drawingTemplates`). */
export interface DrawingTemplate {
  id: string;
  name: string;
  style: { color?: string; lineWidth?: number; lineStyle?: 0 | 1 | 2; [key: string]: unknown };
}

export type WatchlistItem =
  | { id: string; type: "symbol"; value: string; flagColor?: string }
  | { id: string; type: "label"; value: string };

export interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
}

/** Tabs available in the right sidebar. */
export type RightSidebarTab = "watchlist" | "objects" | "trade" | "alerts";

/** Tagged settings target — either a builtin indicator key or an EMA instance id. */
export type SettingsTarget = IndicatorKey | { kind: "ema"; id: string };

export type ChartType =
  | "candles"
  | "line"
  | "area"
  | "bars"
  | "hollow-candles"
  | "line-with-markers"
  | "step-line";

/** Overrides applied automatically when the user selects a given symbol. */
const SYMBOL_DEFAULTS: Partial<Record<string, { timeframe?: Timeframe; chartType?: ChartType }>> = {
  USBCOI:   { timeframe: "1M", chartType: "line" },
  USM2:     { timeframe: "1M", chartType: "line" },
  USM1:     { timeframe: "1M", chartType: "line" },
  WALCL:    { timeframe: "1w", chartType: "line" },
  CIVPART:  { timeframe: "1M", chartType: "line" },
  UNRATE:   { timeframe: "1M", chartType: "line" },
  CPIAUCSL: { timeframe: "1M", chartType: "line" },
  GDP:      { timeframe: "1M", chartType: "line" },
  DGS10:    { chartType: "line" },
  DGS2:     { chartType: "line" },
  T10Y2Y:   { chartType: "line" },
  DFF:      { chartType: "line" },
  RRPONTSYD:{ chartType: "line" },
  USEPU:    { chartType: "line" },
  // Dominance / market-cap series
  "BTC.D":  { timeframe: "1d", chartType: "line" },
  "ETH.D":  { timeframe: "1d", chartType: "line" },
  TOTAL:    { timeframe: "1d", chartType: "line" },
  TOTAL2:   { timeframe: "1d", chartType: "line" },
  TOTAL3:   { timeframe: "1d", chartType: "line" },
};

interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  /** Main pane price series rendering style. */
  chartType: ChartType;
  /** Indicator is added to the chart (appears in pill + renders unless hidden) */
  indicators: Record<IndicatorKey, boolean>;
  /** Indicator is hidden (eye icon off) — kept in pill list, just not rendered */
  hidden: Record<IndicatorKey, boolean>;
  /** Periods and parameters for each indicator */
  config: IndicatorConfig;
  /** User-added EMA instances (multi-instance) */
  userEMAs: UserEMA[];
  /** ADX indicator style overrides */
  adxStyle: AdxStyle;
  keyLevels: KeyLevelsConfig;
  /** Squeeze indicator style overrides */
  squeezeStyle: SqueezeStyle;
  /** Bollinger Bands style overrides */
  bollingerStyle: BollingerStyle;
  /** VWAP style overrides */
  vwapStyle: VwapStyle;
  /** Volume Profile (visible range) inputs + style */
  volumeProfile: VolumeProfileConfig;
  /** Logarithmic price scale (main pane only) */
  logScale: boolean;
  /** Per-indicator log scale toggle (sub-panes) */
  indicatorLogScale: Partial<Record<IndicatorKey, boolean>>;
  /** Main pane price-scale mode — mutually exclusive with `logScale` */
  mainPriceScaleMode: "normal" | "percentage" | "indexed100";
  /** Main pane price-scale inversion (high/low flipped) */
  mainPriceScaleInverted: boolean;
  /** How many recent bars to show when (re)loading a chart */
  visibleBars: number;
  /** Whether the indicator pill list on the main pane is collapsed */
  pillsCollapsed: boolean;
  /** When true, all sub-pane indicators (RSI/MACD/ADX/Squeeze/VuManChu/OBV) are hidden. */
  subPanesHidden: boolean;
  /** Persistent OHLC snap — same effect as holding Ctrl/Cmd while dragging */
  magnetMode: boolean;
  /** Show the countdown to the current bar's close on the price axis. */
  showBarCountdown: boolean;
  /**
   * Maps an indicator to the indicator whose pane it shares ("own" = its own
   * pane). E.g. { adx: "squeeze" } overlays ADX on the Squeeze pane.
   */
  indicatorOverlays: Partial<Record<IndicatorKey, IndicatorKey | "own">>;
  /**
   * Per-pane visual render order. Key = the pane host's IndicatorKey.
   * Value = array of all indicator keys in that pane ordered bottom-to-top
   * (last element renders on top). Unset = default [host, ...guests].
   */
  paneZOrder: Partial<Record<IndicatorKey, IndicatorKey[]>>;
  /**
   * Display order of the main-pane pill row (EMAs, Volume, Key Levels).
   * Entries are `ema:<id>` for user EMAs, or the bare indicator key
   * otherwise. Unlisted/unknown keys render after listed ones, in their
   * natural order — so new pills just show up at the end.
   */
  mainPaneOrder: string[];
  /** Timeframes shown in the quick-access bar. User-configurable. */
  pinnedTimeframes: Timeframe[];

  /**
   * Drawing tools the user starred. Rendered in the floating favorites bar.
   */
  favoriteTools: DrawingTool[];
  /** Persisted position (px, relative to the chart area) of the floating
   *  favorites bar. Null = not placed yet (defaults to top-centered). */
  favoritesBarPos: { x: number; y: number } | null;

  /** Persisted width (px) of the right sidebar (watchlist/objects/trade tabs),
   *  resized by dragging its left edge. */
  rightSidebarWidth: number;
  /** Active right-sidebar tab. In the store (not local state) so the chart's
   *  Trade/Buy/Sell overlay can bring the order panel up. */
  rightSidebarTab: RightSidebarTab;

  /**
   * Per-drawing-kind defaults (color, lineWidth, lineStyle). Applied to new
   * drawings. Updated when the user edits a drawing's style — so next time
   * they use the same tool, the same style is pre-selected.
   */
  toolDefaults: Partial<
    Record<
      string,
      { color?: string; lineWidth?: number; lineStyle?: 0 | 1 | 2; [key: string]: unknown }
    >
  >;
  /**
   * Named, saveable style presets per drawing kind — unlike `toolDefaults`
   * (the single "last style used" applied automatically to new drawings),
   * these are explicit ("Save as template…") and applied on demand to the
   * selected drawing from the floating toolbar.
   */
  drawingTemplates: Partial<Record<string, DrawingTemplate[]>>;
  /** User watchlists with sections/labels */
  watchlists: Watchlist[];
  activeWatchlistId: string;
  /** Active column sort for the watchlist (persisted so it survives reload) */
  watchlistSort: WatchSort;
  /** Ids of collapsed watchlist section labels (persisted so it survives reload) */
  watchlistCollapsedLabels: string[];
  /**
   * Last flag colour the user picked. A plain click on a row's flag strip
   * reuses it, so flagging a run of symbols the same colour is one click each
   * instead of a trip through the picker every time.
   */
  lastFlagColor: string;

  /** Chart color customization */
  chartColors: ChartColors;

  // Ephemeral UI state (not persisted)
  tool: DrawingTool;
  symbolDialogOpen: boolean;
  symbolDialogInitialQuery: string;
  /** Watchlist item id a symbol picked from the dialog should land right after (null = append at the end). */
  symbolDialogInsertAfterId: string | null;
  /** Which indicator/EMA's settings dialog is open (null = closed) */
  settingsTarget: SettingsTarget | null;
  chartSettingsOpen: boolean;
  /** Create-alert dialog state */
  alertDialogOpen: boolean;
  alertDialogPrice: number | null;
  /** Id of the alert being edited, or null when the dialog is creating a new one */
  alertDialogEditId: string | null;
  /** Latest live price for the current symbol (updated on each WS tick) */
  currentLivePrice: number | null;

  // Actions
  setSymbol: (s: string) => void;
  setTimeframe: (t: Timeframe) => void;
  setChartType: (t: ChartType) => void;
  setChartColors: (patch: Partial<ChartColors>) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  removeIndicator: (key: IndicatorKey) => void;
  toggleHidden: (key: IndicatorKey) => void;
  setConfig: (patch: Partial<IndicatorConfig>) => void;
  addUserEMA: () => void;
  removeUserEMA: (id: string) => void;
  updateUserEMA: (id: string, patch: Partial<UserEMA>) => void;
  toggleUserEMAHidden: (id: string) => void;
  setAdxStyle: (patch: Partial<AdxStyle>) => void;
  setKeyLevels: (patch: Partial<KeyLevelsConfig>) => void;
  setSqueezeStyle: (patch: Partial<SqueezeStyle>) => void;
  setBollingerStyle: (patch: Partial<BollingerStyle>) => void;
  setVwapStyle: (patch: Partial<VwapStyle>) => void;
  setVolumeProfile: (patch: Partial<VolumeProfileConfig>) => void;
  setLogScale: (v: boolean) => void;
  setIndicatorLogScale: (key: IndicatorKey, v: boolean) => void;
  setMainPriceScaleMode: (mode: "normal" | "percentage" | "indexed100") => void;
  toggleMainPriceScaleInverted: () => void;
  setVisibleBars: (n: number) => void;
  setPillsCollapsed: (v: boolean) => void;
  setSubPanesHidden: (v: boolean) => void;
  toggleSubPanesHidden: () => void;
  toggleMagnetMode: () => void;
  setShowBarCountdown: (v: boolean) => void;
  setIndicatorOverlay: (key: IndicatorKey, target: IndicatorKey | "own") => void;
  setPaneZOrder: (host: IndicatorKey, order: IndicatorKey[]) => void;
  setMainPaneOrder: (order: string[]) => void;
  setPinnedTimeframes: (tfs: Timeframe[]) => void;
  toggleFavoriteTool: (t: DrawingTool) => void;
  /** Replace the favorites order (drag-to-reorder in the favorites bar). */
  setFavoriteTools: (tools: DrawingTool[]) => void;
  setFavoritesBarPos: (pos: { x: number; y: number } | null) => void;
  setRightSidebarWidth: (width: number) => void;
  setRightSidebarTab: (tab: RightSidebarTab) => void;
  setToolDefault: (
    kind: string,
    patch: { color?: string; lineWidth?: number; lineStyle?: 0 | 1 | 2; [key: string]: unknown },
  ) => void;
  /** Drop a kind's saved defaults so new drawings fall back to the built-ins. */
  clearToolDefault: (kind: string) => void;
  saveDrawingTemplate: (kind: string, name: string, style: DrawingTemplate["style"]) => void;
  deleteDrawingTemplate: (kind: string, templateId: string) => void;
  createWatchlist: (name: string) => string;
  renameWatchlist: (id: string, name: string) => void;
  deleteWatchlist: (id: string) => void;
  duplicateWatchlist: (id: string) => string | undefined;
  clearWatchlistItems: (id: string) => void;
  setActiveWatchlist: (id: string) => void;
  addSymbolToWatchlist: (watchlistId: string, symbol: string) => void;
  moveWatchlistItemToList: (fromId: string, toId: string, itemId: string) => void;
  removeWatchlistItems: (watchlistId: string, itemIds: string[]) => void;
  setWatchlistItemsFlag: (watchlistId: string, itemIds: string[], color: string | null) => void;
  addLabelToWatchlist: (watchlistId: string, label: string, beforeId?: string) => void;
  removeWatchlistItem: (watchlistId: string, itemId: string) => void;
  setLastFlagColor: (color: string) => void;
  setWatchlistItemFlag: (watchlistId: string, itemId: string, color: string | null) => void;
  reorderWatchlistItems: (watchlistId: string, fromId: string, toId: string) => void;
  renameWatchlistItem: (watchlistId: string, itemId: string, value: string) => void;
  setWatchlistSort: (sort: WatchSort) => void;
  toggleWatchlistLabelCollapsed: (labelId: string) => void;
  setTool: (t: DrawingTool) => void;
  setSymbolDialogOpen: (v: boolean) => void;
  setSymbolDialogInitialQuery: (q: string) => void;
  setSymbolDialogInsertAfterId: (id: string | null) => void;
  setSettingsTarget: (k: SettingsTarget | null) => void;
  setChartSettingsOpen: (v: boolean) => void;
  openAlertDialog: (price?: number) => void;
  openEditAlertDialog: (alertId: string) => void;
  closeAlertDialog: () => void;
  setCurrentLivePrice: (price: number | null) => void;
  /** Apply a partial snapshot from undo/redo — does NOT push to history */
  applySnapshot: (snap: ChartStateSnapshot) => void;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function initialWatchlists(): {
  watchlists: Watchlist[];
  activeWatchlistId: string;
} {
  const id = randomId();
  return {
    watchlists: [
      {
        id,
        name: "Default",
        items: DEFAULT_WATCHLIST.map((sym) => ({
          id: randomId(),
          type: "symbol" as const,
          value: sym,
        })),
      },
    ],
    activeWatchlistId: id,
  };
}

/** Every indicator off — the shape both `indicators` and `hidden` must have. */
export const ALL_INDICATORS_FALSE: Record<IndicatorKey, boolean> = {
  rsi: false,
  macd: false,
  volume: false,
  adx: false,
  squeeze: false,
  vumanchu: false,
  obv: false,
  keylevels: false,
  bb: false,
  vwap: false,
  vrvp: false,
  stochrsi: false,
  williamsr: false,
  atr: false,
  cci: false,
  mfi: false,
};

/** What a brand-new chart starts with. */
export const DEFAULT_INDICATORS: Record<IndicatorKey, boolean> = {
  ...ALL_INDICATORS_FALSE,
  rsi: true,
  volume: true,
};

export const useChartStore = create<ChartState>()(
  persist(
    (set, get) => ({
      symbol: "BTCUSDT",
      chartType: "candles" as ChartType,
      timeframe: "15m" as Timeframe,
      indicators: { ...DEFAULT_INDICATORS },
      hidden: { ...ALL_INDICATORS_FALSE },
      config: { ...DEFAULT_CONFIG },
      userEMAs: [
        { id: randomId(), period: 20, color: EMA_PALETTE[0], lineWidth: 1, hidden: false },
        { id: randomId(), period: 50, color: EMA_PALETTE[1], lineWidth: 1, hidden: false },
      ],
      adxStyle: { ...DEFAULT_ADX_STYLE },
      keyLevels: { ...DEFAULT_KEY_LEVELS },
      squeezeStyle: { ...DEFAULT_SQUEEZE_STYLE },
      bollingerStyle: { ...DEFAULT_BOLLINGER_STYLE },
      vwapStyle: { ...DEFAULT_VWAP_STYLE },
      volumeProfile: { ...DEFAULT_VOLUME_PROFILE },
      logScale: false,
      mainPriceScaleMode: "normal",
      mainPriceScaleInverted: false,
      indicatorLogScale: {},
      visibleBars: 150,
      pillsCollapsed: false,
      subPanesHidden: false,
      magnetMode: false,
      showBarCountdown: true,
      indicatorOverlays: {},
      paneZOrder: {},
      mainPaneOrder: [],
      pinnedTimeframes: ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"] as Timeframe[],
      favoriteTools: [],
      favoritesBarPos: null,
      rightSidebarWidth: 256,
      rightSidebarTab: "watchlist",
      toolDefaults: {},
      drawingTemplates: {},
      ...initialWatchlists(),
      watchlistSort: { key: "manual", dir: "desc" },
      watchlistCollapsedLabels: [],
      lastFlagColor: DEFAULT_FLAG_COLOR,
      chartColors: { ...DEFAULT_CHART_COLORS },
      tool: "cursor",
      symbolDialogOpen: false,
      symbolDialogInitialQuery: "",
      symbolDialogInsertAfterId: null,
      settingsTarget: null,
      chartSettingsOpen: false,
      alertDialogOpen: false,
      alertDialogPrice: null,
      alertDialogEditId: null,
      currentLivePrice: null,

      setSymbol: (symbol) => {
        const defaults = SYMBOL_DEFAULTS[symbol.toUpperCase()];
        set({
          symbol,
          ...(defaults?.timeframe !== undefined && { timeframe: defaults.timeframe }),
          ...(defaults?.chartType !== undefined && { chartType: defaults.chartType }),
        });
      },
      setTimeframe: (timeframe) => set({ timeframe }),
      setChartType: (chartType) => set({ chartType }),

      toggleIndicator: (key) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { indicators: { ...s.indicators }, hidden: { ...s.hidden } };
          set((st) => ({
            indicators: { ...st.indicators, [key]: !st.indicators[key] },
            hidden: !st.indicators[key] ? { ...st.hidden, [key]: false } : st.hidden,
          }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { indicators: { ...after.indicators }, hidden: { ...after.hidden } } });
        } else {
          set((st) => ({
            indicators: { ...st.indicators, [key]: !st.indicators[key] },
            hidden: !st.indicators[key] ? { ...st.hidden, [key]: false } : st.hidden,
          }));
        }
      },

      removeIndicator: (key) => {
        if (!isApplyingHistory) {
          const s = get();
          // Snapshot includes style fields so ONE undo restores the indicator + all its settings.
          const before: ChartStateSnapshot = {
            indicators: { ...s.indicators },
            hidden: { ...s.hidden },
            config: { ...s.config },
            adxStyle: { ...s.adxStyle },
            squeezeStyle: { ...s.squeezeStyle },
            indicatorOverlays: { ...s.indicatorOverlays },
          };
          set((st) => ({ indicators: { ...st.indicators, [key]: false }, hidden: { ...st.hidden, [key]: false } }));
          const after = get();
          unifiedHistory.push({
            kind: "chartState",
            before,
            after: { indicators: { ...after.indicators }, hidden: { ...after.hidden } },
          });
        } else {
          set((st) => ({ indicators: { ...st.indicators, [key]: false }, hidden: { ...st.hidden, [key]: false } }));
        }
      },

      toggleHidden: (key) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { hidden: { ...s.hidden } };
          set((st) => ({ hidden: { ...st.hidden, [key]: !st.hidden[key] } }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { hidden: { ...after.hidden } } });
        } else {
          set((st) => ({ hidden: { ...st.hidden, [key]: !st.hidden[key] } }));
        }
      },

      setConfig: (patch) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { config: { ...s.config } };
          set((st) => ({ config: { ...st.config, ...patch } }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { config: { ...after.config } } });
        } else {
          set((st) => ({ config: { ...st.config, ...patch } }));
        }
      },

      addUserEMA: () => {
        const s = get();
        const before: ChartStateSnapshot = { userEMAs: [...s.userEMAs] };
        set((st) => {
          const usedColors = new Set(st.userEMAs.map((e) => e.color));
          const nextColor = EMA_PALETTE.find((c) => !usedColors.has(c)) ?? EMA_PALETTE[st.userEMAs.length % EMA_PALETTE.length];
          const maxPeriod = st.userEMAs.reduce((m, e) => Math.max(m, e.period), 0);
          const suggested = maxPeriod > 0 ? Math.min(maxPeriod * 2, 500) : 9;
          return { userEMAs: [...st.userEMAs, { id: randomId(), period: suggested, color: nextColor, lineWidth: 1, hidden: false }] };
        });
        if (!isApplyingHistory) {
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { userEMAs: [...after.userEMAs] } });
        }
      },

      removeUserEMA: (id) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { userEMAs: [...s.userEMAs] };
          set((st) => ({ userEMAs: st.userEMAs.filter((e) => e.id !== id) }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { userEMAs: [...after.userEMAs] } });
        } else {
          set((st) => ({ userEMAs: st.userEMAs.filter((e) => e.id !== id) }));
        }
      },

      updateUserEMA: (id, patch) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { userEMAs: [...s.userEMAs] };
          set((st) => ({ userEMAs: st.userEMAs.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { userEMAs: [...after.userEMAs] } });
        } else {
          set((st) => ({ userEMAs: st.userEMAs.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
        }
      },

      toggleUserEMAHidden: (id) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { userEMAs: [...s.userEMAs] };
          set((st) => ({ userEMAs: st.userEMAs.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)) }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { userEMAs: [...after.userEMAs] } });
        } else {
          set((st) => ({ userEMAs: st.userEMAs.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)) }));
        }
      },

      setAdxStyle: (patch) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { adxStyle: { ...s.adxStyle } };
          set((st) => ({ adxStyle: { ...st.adxStyle, ...patch } }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { adxStyle: { ...after.adxStyle } } });
        } else {
          set((st) => ({ adxStyle: { ...st.adxStyle, ...patch } }));
        }
      },

      setKeyLevels: (patch) => set((st) => ({
        keyLevels: {
          ...st.keyLevels,
          ...patch,
          daily:     { ...st.keyLevels.daily,     ...(patch.daily     ?? {}) },
          monday:    { ...st.keyLevels.monday,    ...(patch.monday    ?? {}) },
          weekly:    { ...st.keyLevels.weekly,    ...(patch.weekly    ?? {}) },
          monthly:   { ...st.keyLevels.monthly,   ...(patch.monthly   ?? {}) },
          quarterly: { ...st.keyLevels.quarterly, ...(patch.quarterly ?? {}) },
          yearly:    { ...st.keyLevels.yearly,    ...(patch.yearly    ?? {}) },
          fourHour:  { ...st.keyLevels.fourHour,  ...(patch.fourHour  ?? {}) },
        },
      })),

      setSqueezeStyle: (patch) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { squeezeStyle: { ...s.squeezeStyle } };
          set((st) => ({ squeezeStyle: { ...st.squeezeStyle, ...patch } }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { squeezeStyle: { ...after.squeezeStyle } } });
        } else {
          set((st) => ({ squeezeStyle: { ...st.squeezeStyle, ...patch } }));
        }
      },

      setBollingerStyle: (patch) =>
        set((st) => ({ bollingerStyle: { ...st.bollingerStyle, ...patch } })),

      setVwapStyle: (patch) => set((st) => ({ vwapStyle: { ...st.vwapStyle, ...patch } })),

      setVolumeProfile: (patch) =>
        set((st) => ({ volumeProfile: { ...st.volumeProfile, ...patch } })),

      setLogScale: (logScale) => {
        // Log and percentage/indexed-to-100 are mutually exclusive price-scale
        // modes in lightweight-charts, so enabling one clears the other.
        if (!isApplyingHistory) {
          const before: ChartStateSnapshot = {
            logScale: get().logScale,
            mainPriceScaleMode: get().mainPriceScaleMode,
          };
          const after: ChartStateSnapshot = { logScale, mainPriceScaleMode: "normal" };
          set(after);
          unifiedHistory.push({ kind: "chartState", before, after });
        } else {
          set({ logScale, mainPriceScaleMode: "normal" });
        }
      },
      setMainPriceScaleMode: (mainPriceScaleMode) => {
        if (!isApplyingHistory) {
          const before: ChartStateSnapshot = {
            mainPriceScaleMode: get().mainPriceScaleMode,
            logScale: get().logScale,
          };
          const after: ChartStateSnapshot = { mainPriceScaleMode, logScale: false };
          set(after);
          unifiedHistory.push({ kind: "chartState", before, after });
        } else {
          set({ mainPriceScaleMode, logScale: false });
        }
      },
      toggleMainPriceScaleInverted: () => {
        const mainPriceScaleInverted = !get().mainPriceScaleInverted;
        if (!isApplyingHistory) {
          const before: ChartStateSnapshot = { mainPriceScaleInverted: get().mainPriceScaleInverted };
          set({ mainPriceScaleInverted });
          unifiedHistory.push({
            kind: "chartState",
            before,
            after: { mainPriceScaleInverted },
          });
        } else {
          set({ mainPriceScaleInverted });
        }
      },

      setIndicatorLogScale: (key, v) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { indicatorLogScale: { ...s.indicatorLogScale } };
          set((st) => ({ indicatorLogScale: { ...st.indicatorLogScale, [key]: v } }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { indicatorLogScale: { ...after.indicatorLogScale } } });
        } else {
          set((st) => ({ indicatorLogScale: { ...st.indicatorLogScale, [key]: v } }));
        }
      },

      setVisibleBars: (visibleBars) => set({ visibleBars }),
      setPillsCollapsed: (pillsCollapsed) => set({ pillsCollapsed }),
      setSubPanesHidden: (subPanesHidden) => set({ subPanesHidden }),
      toggleSubPanesHidden: () => set((s) => ({ subPanesHidden: !s.subPanesHidden })),
      toggleMagnetMode: () => set((s) => ({ magnetMode: !s.magnetMode })),
      setShowBarCountdown: (showBarCountdown) => set({ showBarCountdown }),

      setIndicatorOverlay: (key, target) => {
        if (!isApplyingHistory) {
          const s = get();
          const before: ChartStateSnapshot = { indicatorOverlays: { ...s.indicatorOverlays } };
          set((st) => ({ indicatorOverlays: { ...st.indicatorOverlays, [key]: target } }));
          const after = get();
          unifiedHistory.push({ kind: "chartState", before, after: { indicatorOverlays: { ...after.indicatorOverlays } } });
        } else {
          set((st) => ({ indicatorOverlays: { ...st.indicatorOverlays, [key]: target } }));
        }
      },

      setPaneZOrder: (host, order) =>
        set((st) => ({ paneZOrder: { ...st.paneZOrder, [host]: order } })),
      setMainPaneOrder: (mainPaneOrder) => set({ mainPaneOrder }),

      setPinnedTimeframes: (pinnedTimeframes) => set({ pinnedTimeframes }),
      toggleFavoriteTool: (t) =>
        set((s) => ({
          favoriteTools: s.favoriteTools.includes(t)
            ? s.favoriteTools.filter((x) => x !== t)
            : [...s.favoriteTools, t],
        })),
      setFavoriteTools: (favoriteTools) => set({ favoriteTools }),
      setFavoritesBarPos: (favoritesBarPos) => set({ favoritesBarPos }),
      setRightSidebarWidth: (width) =>
        set({ rightSidebarWidth: Math.min(900, Math.max(200, width)) }),
      setRightSidebarTab: (rightSidebarTab) => set({ rightSidebarTab }),

      applySnapshot: (snap) => {
        withoutHistory(() => {
          const patch: Partial<ChartState> = {};
          if (snap.indicators !== undefined) patch.indicators = snap.indicators;
          if (snap.hidden !== undefined) patch.hidden = snap.hidden;
          if (snap.config !== undefined) patch.config = snap.config;
          if (snap.userEMAs !== undefined) patch.userEMAs = snap.userEMAs;
          if (snap.adxStyle !== undefined) patch.adxStyle = snap.adxStyle;
          if (snap.squeezeStyle !== undefined) patch.squeezeStyle = snap.squeezeStyle;
          if (snap.logScale !== undefined) patch.logScale = snap.logScale;
          if (snap.indicatorLogScale !== undefined) patch.indicatorLogScale = snap.indicatorLogScale;
          if (snap.indicatorOverlays !== undefined) patch.indicatorOverlays = snap.indicatorOverlays;
          set(patch as Partial<ChartState>);
        });
      },
      setToolDefault: (kind, patch) =>
        set((s) => ({
          toolDefaults: {
            ...s.toolDefaults,
            [kind]: { ...(s.toolDefaults[kind] as Record<string, unknown> ?? {}), ...patch },
          },
        })),
      clearToolDefault: (kind) =>
        set((s) => {
          const next = { ...s.toolDefaults };
          delete next[kind];
          return { toolDefaults: next };
        }),
      saveDrawingTemplate: (kind, name, style) =>
        set((s) => ({
          drawingTemplates: {
            ...s.drawingTemplates,
            [kind]: [...(s.drawingTemplates[kind] ?? []), { id: randomId(), name, style }],
          },
        })),
      deleteDrawingTemplate: (kind, templateId) =>
        set((s) => ({
          drawingTemplates: {
            ...s.drawingTemplates,
            [kind]: (s.drawingTemplates[kind] ?? []).filter((t) => t.id !== templateId),
          },
        })),
      createWatchlist: (name) => {
        const id = randomId();
        set((state) => ({
          watchlists: [...state.watchlists, { id, name, items: [] }],
          activeWatchlistId: id,
        }));
        return id;
      },
      renameWatchlist: (id, name) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) =>
            w.id === id ? { ...w, name } : w,
          ),
        })),
      deleteWatchlist: (id) =>
        set((state) => {
          if (state.watchlists.length <= 1) return state;
          const next = state.watchlists.filter((w) => w.id !== id);
          return {
            watchlists: next,
            activeWatchlistId:
              state.activeWatchlistId === id
                ? next[0].id
                : state.activeWatchlistId,
          };
        }),
      duplicateWatchlist: (id) => {
        const source = get().watchlists.find((w) => w.id === id);
        if (!source) return undefined;
        const newId = randomId();
        set((state) => ({
          watchlists: [
            ...state.watchlists,
            {
              id: newId,
              name: `${source.name} copy`,
              // Fresh ids so the copy doesn't share item identity with the
              // original (e.g. drag/reorder or the insert-after-this-row
              // cursor could otherwise cross-reference the wrong list).
              items: source.items.map((i) => ({ ...i, id: randomId() })),
            },
          ],
          activeWatchlistId: newId,
        }));
        return newId;
      },
      clearWatchlistItems: (id) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) =>
            w.id === id ? { ...w, items: [] } : w,
          ),
        })),
      setActiveWatchlist: (id) => set({ activeWatchlistId: id }),
      addSymbolToWatchlist: (watchlistId, symbol) =>
        set((state) => {
          // A symbol added right after a right-clicked row lands there instead
          // of at the bottom; picking several in a row keeps chaining off the
          // last one added, so a batch stays together where it was started.
          const afterId = state.symbolDialogInsertAfterId;
          const newId = randomId();
          let inserted = false;
          const watchlists = state.watchlists.map((w) => {
            if (w.id !== watchlistId) return w;
            if (w.items.some((i) => i.type === "symbol" && i.value === symbol)) {
              return w;
            }
            inserted = true;
            const newItem: WatchlistItem = { id: newId, type: "symbol", value: symbol };
            const idx = afterId ? w.items.findIndex((i) => i.id === afterId) : -1;
            if (idx === -1) return { ...w, items: [...w.items, newItem] };
            return {
              ...w,
              items: [...w.items.slice(0, idx + 1), newItem, ...w.items.slice(idx + 1)],
            };
          });
          return {
            watchlists,
            symbolDialogInsertAfterId:
              inserted && afterId ? newId : state.symbolDialogInsertAfterId,
          };
        }),
      addLabelToWatchlist: (watchlistId, label, beforeId) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) => {
            if (w.id !== watchlistId) return w;
            const newItem: WatchlistItem = {
              id: randomId(),
              type: "label",
              value: label,
            };
            if (!beforeId) {
              return { ...w, items: [...w.items, newItem] };
            }
            const idx = w.items.findIndex((i) => i.id === beforeId);
            if (idx === -1) return { ...w, items: [...w.items, newItem] };
            return {
              ...w,
              items: [...w.items.slice(0, idx), newItem, ...w.items.slice(idx)],
            };
          }),
        })),
      removeWatchlistItem: (watchlistId, itemId) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) =>
            w.id === watchlistId
              ? { ...w, items: w.items.filter((i) => i.id !== itemId) }
              : w,
          ),
        })),
      removeWatchlistItems: (watchlistId, itemIds) =>
        set((state) => {
          const ids = new Set(itemIds);
          return {
            watchlists: state.watchlists.map((w) =>
              w.id === watchlistId
                ? { ...w, items: w.items.filter((i) => !ids.has(i.id)) }
                : w,
            ),
          };
        }),
      setWatchlistItemsFlag: (watchlistId, itemIds, color) =>
        set((state) => {
          const ids = new Set(itemIds);
          return {
            watchlists: state.watchlists.map((w) =>
              w.id === watchlistId
                ? {
                    ...w,
                    items: w.items.map((i) =>
                      ids.has(i.id) && i.type === "symbol"
                        ? { ...i, flagColor: color ?? undefined }
                        : i,
                    ),
                  }
                : w,
            ),
          };
        }),
      moveWatchlistItemToList: (fromId, toId, itemId) =>
        set((state) => {
          if (fromId === toId) return state;
          const from = state.watchlists.find((w) => w.id === fromId);
          const item = from?.items.find((i) => i.id === itemId);
          if (!from || !item || item.type !== "symbol") return state;
          return {
            watchlists: state.watchlists.map((w) => {
              if (w.id === fromId) {
                return { ...w, items: w.items.filter((i) => i.id !== itemId) };
              }
              if (w.id === toId) {
                // Skip if already present in the destination list.
                if (w.items.some((i) => i.type === "symbol" && i.value === item.value)) {
                  return w;
                }
                return { ...w, items: [...w.items, item] };
              }
              return w;
            }),
          };
        }),
      setLastFlagColor: (lastFlagColor) => set({ lastFlagColor }),
      setWatchlistItemFlag: (watchlistId, itemId, color) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) =>
            w.id === watchlistId
              ? {
                  ...w,
                  items: w.items.map((i) =>
                    i.id === itemId && i.type === "symbol"
                      ? { ...i, flagColor: color ?? undefined }
                      : i,
                  ),
                }
              : w,
          ),
        })),
      reorderWatchlistItems: (watchlistId, fromId, toId) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) => {
            if (w.id !== watchlistId) return w;
            const from = w.items.findIndex((i) => i.id === fromId);
            const to = w.items.findIndex((i) => i.id === toId);
            if (from === -1 || to === -1 || from === to) return w;

            // A label is the parent of every symbol below it (up to the next
            // label), so dragging the label carries that whole block along
            // instead of leaving its symbols orphaned under the old section.
            const dragged = w.items[from];
            let blockLen = 1;
            if (dragged.type === "label") {
              while (
                from + blockLen < w.items.length &&
                w.items[from + blockLen].type !== "label"
              ) {
                blockLen++;
              }
            }
            if (to >= from && to < from + blockLen) return w; // dropped inside own block

            const block = w.items.slice(from, from + blockLen);
            const rest = [...w.items.slice(0, from), ...w.items.slice(from + blockLen)];
            const insertAt = rest.findIndex((i) => i.id === toId);
            const at = from < to ? insertAt + 1 : insertAt;
            rest.splice(at, 0, ...block);
            return { ...w, items: rest };
          }),
        })),
      renameWatchlistItem: (watchlistId, itemId, value) =>
        set((state) => ({
          watchlists: state.watchlists.map((w) =>
            w.id === watchlistId
              ? {
                  ...w,
                  items: w.items.map((i) =>
                    i.id === itemId ? { ...i, value } : i,
                  ),
                }
              : w,
          ),
        })),
      setWatchlistSort: (watchlistSort) => set({ watchlistSort }),
      toggleWatchlistLabelCollapsed: (labelId) =>
        set((state) => {
          const has = state.watchlistCollapsedLabels.includes(labelId);
          return {
            watchlistCollapsedLabels: has
              ? state.watchlistCollapsedLabels.filter((id) => id !== labelId)
              : [...state.watchlistCollapsedLabels, labelId],
          };
        }),
      setChartColors: (patch) =>
        set((s) => ({ chartColors: { ...s.chartColors, ...patch } })),
      setTool: (tool) => set({ tool }),
      setSymbolDialogOpen: (symbolDialogOpen) => set({ symbolDialogOpen }),
      setSymbolDialogInitialQuery: (symbolDialogInitialQuery) => set({ symbolDialogInitialQuery }),
      setSymbolDialogInsertAfterId: (symbolDialogInsertAfterId) => set({ symbolDialogInsertAfterId }),
      setSettingsTarget: (settingsTarget) => set({ settingsTarget }),
      setChartSettingsOpen: (chartSettingsOpen) => set({ chartSettingsOpen }),
      openAlertDialog: (price) =>
        set({ alertDialogOpen: true, alertDialogPrice: price ?? null, alertDialogEditId: null }),
      openEditAlertDialog: (alertId) =>
        set({ alertDialogOpen: true, alertDialogPrice: null, alertDialogEditId: alertId }),
      closeAlertDialog: () =>
        set({ alertDialogOpen: false, alertDialogPrice: null, alertDialogEditId: null }),
      setCurrentLivePrice: (currentLivePrice) => set({ currentLivePrice }),
    }),
    {
      name: "tv-gratis-chart-state",
      version: 8,
      migrate: (persisted, fromVersion) => {
        const p = persisted as Record<string, unknown>;
        if (fromVersion < 3 && Array.isArray(p.watchlist)) {
          const id = randomId();
          p.watchlists = [
            {
              id,
              name: "Default",
              items: (p.watchlist as string[]).map((sym) => ({
                id: randomId(),
                type: "symbol",
                value: sym,
              })),
            },
          ];
          p.activeWatchlistId = id;
          delete p.watchlist;
        }
        // v4: fill in adxKeyLevel and showKeyLevel defaults for users who persisted
        // state before these fields were added (they'd be undefined otherwise).
        // Also reset keyLevelColor from old gray to white so it's visible on dark bg.
        if (fromVersion < 4) {
          const cfg = p.config as Record<string, unknown> | undefined;
          if (cfg && cfg.adxKeyLevel === undefined) cfg.adxKeyLevel = 23;
          const adxStyle = p.adxStyle as Record<string, unknown> | undefined;
          if (adxStyle && adxStyle.showKeyLevel === undefined) adxStyle.showKeyLevel = true;
          if (adxStyle && adxStyle.keyLevelColor === "#787b86") adxStyle.keyLevelColor = "#ffffff";
        }
        // v6: eight new indicators (BB, VWAP, VRVP, StochRSI, %R, ATR, CCI, MFI).
        // A persisted `indicators`/`hidden` map predates their keys, and a
        // missing key reads as undefined rather than false — harmless for the
        // toggles, but `Object.values(indicators).filter(Boolean)` and the
        // pane-index walk both assume a complete record.
        if (fromVersion < 6) {
          p.indicators = { ...ALL_INDICATORS_FALSE, ...(p.indicators as object ?? {}) };
          p.hidden = { ...ALL_INDICATORS_FALSE, ...(p.hidden as object ?? {}) };
          p.config = { ...DEFAULT_CONFIG, ...(p.config as object ?? {}) };
        }
        // v7: the palette moved from pure black to TradingView's cold-gray ramp.
        // A persisted chart-color set is the *old* palette, so an existing user
        // would keep #0e0e0e grid lines and #26a69a candles on the new #0f0f0f
        // background — invisible grid, mismatched candles. Reset the colors to
        // the new defaults. Only the color-carrying fields of the style objects
        // are overwritten: visibility toggles, line widths and the rest are user
        // choices that have nothing to do with the palette.
        if (fromVersion < 7) {
          p.chartColors = { ...DEFAULT_CHART_COLORS };
          const adxStyle = p.adxStyle as Record<string, unknown> | undefined;
          if (adxStyle) {
            adxStyle.adxColor = DEFAULT_ADX_STYLE.adxColor;
            adxStyle.plusDiColor = DEFAULT_ADX_STYLE.plusDiColor;
            adxStyle.minusDiColor = DEFAULT_ADX_STYLE.minusDiColor;
          }
          const squeezeStyle = p.squeezeStyle as Record<string, unknown> | undefined;
          if (squeezeStyle) squeezeStyle.squeezeOff = DEFAULT_SQUEEZE_STYLE.squeezeOff;
          const vwapStyle = p.vwapStyle as Record<string, unknown> | undefined;
          if (vwapStyle) vwapStyle.bandColor = DEFAULT_VWAP_STYLE.bandColor;
          const vp = p.volumeProfile as Record<string, unknown> | undefined;
          if (vp) {
            vp.upColor = DEFAULT_VOLUME_PROFILE.upColor;
            vp.downColor = DEFAULT_VOLUME_PROFILE.downColor;
            vp.valueAreaUpColor = DEFAULT_VOLUME_PROFILE.valueAreaUpColor;
            vp.valueAreaDownColor = DEFAULT_VOLUME_PROFILE.valueAreaDownColor;
          }
          const keyLevels = p.keyLevels as Record<string, { color?: string }> | undefined;
          if (keyLevels?.monthly) keyLevels.monthly.color = DEFAULT_KEY_LEVELS.monthly.color;
          if (keyLevels?.yearly) keyLevels.yearly.color = DEFAULT_KEY_LEVELS.yearly.color;
        }
        // v8: the squeeze-on dot moved off black (invisible on the new
        // background) to amber. Only rewrite it if it is still the old default
        // — a user who picked their own color keeps it, the same conditional
        // shape the v4 keyLevelColor reset uses.
        if (fromVersion < 8) {
          const squeezeStyle = p.squeezeStyle as Record<string, unknown> | undefined;
          if (squeezeStyle?.squeezeOn === "#000000") {
            squeezeStyle.squeezeOn = DEFAULT_SQUEEZE_STYLE.squeezeOn;
          }
        }
        return p;
      },
      partialize: (s) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        indicators: s.indicators,
        hidden: s.hidden,
        config: s.config,
        userEMAs: s.userEMAs,
        adxStyle: s.adxStyle,
        keyLevels: s.keyLevels,
        squeezeStyle: s.squeezeStyle,
        bollingerStyle: s.bollingerStyle,
        vwapStyle: s.vwapStyle,
        volumeProfile: s.volumeProfile,
        logScale: s.logScale,
        indicatorLogScale: s.indicatorLogScale,
        mainPriceScaleMode: s.mainPriceScaleMode,
        mainPriceScaleInverted: s.mainPriceScaleInverted,
        visibleBars: s.visibleBars,
        pillsCollapsed: s.pillsCollapsed,
        subPanesHidden: s.subPanesHidden,
        magnetMode: s.magnetMode,
        showBarCountdown: s.showBarCountdown,
        indicatorOverlays: s.indicatorOverlays,
        paneZOrder: s.paneZOrder,
        mainPaneOrder: s.mainPaneOrder,
        pinnedTimeframes: s.pinnedTimeframes,
        favoriteTools: s.favoriteTools,
        favoritesBarPos: s.favoritesBarPos,
        rightSidebarWidth: s.rightSidebarWidth,
        rightSidebarTab: s.rightSidebarTab,
        toolDefaults: s.toolDefaults,
        drawingTemplates: s.drawingTemplates,
        watchlists: s.watchlists,
        activeWatchlistId: s.activeWatchlistId,
        watchlistSort: s.watchlistSort,
        watchlistCollapsedLabels: s.watchlistCollapsedLabels,
        lastFlagColor: s.lastFlagColor,
        chartColors: s.chartColors,
      }),
    },
  ),
);
