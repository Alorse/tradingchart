export interface Point {
  time: number;
  price: number;
}

export type DrawingKind =
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

export interface AlertConfig {
  enabled: boolean;
  sound: boolean;
  direction: "cross" | "cross-up" | "cross-down";
  lastTriggeredAt?: number;
}

interface BaseDrawing {
  id: string;
  symbol: string;
  color?: string;
  lineWidth?: number;
  /** 0 = solid, 1 = dashed, 2 = dotted */
  lineStyle?: 0 | 1 | 2;
  hidden?: boolean;
  /** When true, the drawing cannot be moved or resized (UI handlers must
   *  short-circuit). Toggled from the floating context toolbar. */
  locked?: boolean;
  /** Explicit stacking order = array index at save time. Persisted so the
   *  object-tree ordering survives a reload; higher = painted on top. */
  z?: number;
  alert?: AlertConfig | null;
}

export interface HLineDrawing extends BaseDrawing {
  kind: "hline";
  price: number;
}

export interface VLineDrawing extends BaseDrawing {
  kind: "vline";
  time: number;
}

export interface TrendLineDrawing extends BaseDrawing {
  kind: "trendline";
  a: Point;
  b: Point;
}

export interface RayDrawing extends BaseDrawing {
  kind: "ray";
  a: Point;
  b: Point;
}

export interface HRayDrawing extends BaseDrawing {
  kind: "hray";
  anchor: Point;
}

export interface ParallelChannelDrawing extends BaseDrawing {
  kind: "parallel-channel";
  a: Point;
  b: Point;
  c: Point;
}

export interface FibRetracementDrawing extends BaseDrawing {
  kind: "fib-retracement";
  a: Point;
  b: Point;
  levels: number[];
}

export interface PriceRangeDrawing extends BaseDrawing {
  kind: "price-range";
  priceA: number;
  priceB: number;
  timeA: number;
  timeB: number;
}

export interface DateRangeDrawing extends BaseDrawing {
  kind: "date-range";
  timeA: number;
  timeB: number;
}

/** Which stats-block rows/cells can be toggled off individually. */
export type PositionStatKey =
  | "openPnl"
  | "qty"
  | "rr"
  | "profitLoss"
  | "pct"
  | "ticks"
  | "balance";

/**
 * Fields shared by long/short position drawings beyond the geometry
 * (entry/stop/target/timeA/timeB, still the source of truth for price/time).
 * Everything here is optional and backwards-compatible: a drawing created
 * before these existed simply falls back to the renderer's defaults.
 */
export interface PositionExtraFields {
  stopColor?: string;
  targetColor?: string;
  textColor?: string;
  /** Font size (px) for stats/pill text. */
  textSize?: number;
  showLabels?: boolean;
  /** Stop line width/style — entry uses the inherited color/lineWidth/lineStyle. */
  stopLineWidth?: number;
  stopLineStyle?: 0 | 1 | 2;
  targetLineWidth?: number;
  targetLineStyle?: 0 | 1 | 2;

  // ── Sizing inputs (Inputs tab). Money/qty stats hide when accountSize or
  // risk is unset — see src/lib/drawings/position-math.ts. ──
  accountSize?: number;
  risk?: number;
  riskIsPercent?: boolean;
  leverage?: number;
  /** Contract size (base units per lot); defaults to 1 (spot/linear perp). */
  lotSize?: number;
  /** Decimal places to display computed qty at. */
  qtyPrecision?: number;
  /** Tick-denominated target/stop offsets, kept in sync with entry/target/stop
   *  by the settings dialog's paired price+ticks fields. */
  ticksTarget?: number;
  ticksStop?: number;

  // ── Display ──
  /** Always render the stats block, instead of only on hover/selection. */
  alwaysShowStats?: boolean;
  /** Render the stats block's compact single-line form. */
  compactStats?: boolean;
  /** Per-stat visibility; unset = show. */
  statsOverrides?: Partial<Record<PositionStatKey, boolean>>;
  /** Draw small price-axis flags at entry/stop/target. */
  priceLabels?: boolean;
  /** Opt-in legacy 1R/2R/3R... guide lines + inner "RR x.xx" label. Default off. */
  showRMultiples?: boolean;
}

export interface LongPositionDrawing extends BaseDrawing, PositionExtraFields {
  kind: "long";
  entry: number;
  stop: number;
  target: number;
  timeA: number;
  timeB: number;
}

export interface ShortPositionDrawing extends BaseDrawing, PositionExtraFields {
  kind: "short";
  entry: number;
  stop: number;
  target: number;
  timeA: number;
  timeB: number;
}

export interface BrushDrawing extends BaseDrawing {
  kind: "brush";
  points: Point[];
  /** Float logical bar indices (from coordinateToLogical) — parallel to points.
   *  When present, rendering uses logicalToCoordinate for pixel-accurate x positions
   *  without any time-based round-trip quantization. */
  logicals?: number[];
}

export interface HighlighterDrawing extends BaseDrawing {
  kind: "highlighter";
  points: Point[];
  logicals?: number[];
}

export interface RectangleDrawing extends BaseDrawing {
  kind: "rectangle";
  a: Point;
  b: Point;
  fillColor?: string;
  fillOpacity?: number;
}

/** Trend line with an arrowhead at point B. Shares the {a,b} shape so it reuses
 *  the trend-line placement/drag path. */
export interface ArrowDrawing extends BaseDrawing {
  kind: "arrow";
  a: Point;
  b: Point;
}

/** Free-floating text label anchored to a (time, price). */
export interface TextDrawing extends BaseDrawing {
  kind: "text";
  anchor: Point;
  text: string;
  fontSize?: number;
}

/** Trend-based Fibonacci extension: A→B move projected forward from C. */
export interface FibExtensionDrawing extends BaseDrawing {
  kind: "fib-extension";
  a: Point;
  b: Point;
  c: Point;
  levels: number[];
}

/** Andrews pitchfork: median from A through the midpoint of B-C, plus parallel
 *  tines through B and C. */
export interface PitchforkDrawing extends BaseDrawing {
  kind: "pitchfork";
  a: Point;
  b: Point;
  c: Point;
}

/** Text bubble that points at `anchor` from a `target` box position. */
export interface CalloutDrawing extends BaseDrawing {
  kind: "callout";
  anchor: Point;
  target: Point;
  text: string;
  fontSize?: number;
}

/** Harmonic pattern: five points X-A-B-C-D connected, with leg-ratio labels. */
export interface XabcdDrawing extends BaseDrawing {
  kind: "xabcd";
  points: Point[];
}

export type Drawing =
  | HLineDrawing
  | VLineDrawing
  | TrendLineDrawing
  | RayDrawing
  | HRayDrawing
  | ParallelChannelDrawing
  | FibRetracementDrawing
  | PriceRangeDrawing
  | DateRangeDrawing
  | LongPositionDrawing
  | ShortPositionDrawing
  | BrushDrawing
  | HighlighterDrawing
  | RectangleDrawing
  | ArrowDrawing
  | TextDrawing
  | FibExtensionDrawing
  | PitchforkDrawing
  | CalloutDrawing
  | XabcdDrawing;

export const FIB_LEVELS_DEFAULT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
