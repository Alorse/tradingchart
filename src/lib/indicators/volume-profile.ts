/**
 * Volume Profile — the price-axis histogram TradingView calls VRVP when it is
 * computed over the visible range.
 *
 * Two things make this different from every other indicator in this folder:
 *
 *  - It is indexed by **price**, not by time. The output is a ladder of rows,
 *    so nothing here can be fed to a lightweight-charts series; it is drawn as
 *    an SVG overlay (`VolumeProfileOverlay.tsx`).
 *  - A candle's volume is **spread across every row its high-low range covers**,
 *    proportionally to the overlap. Dumping the whole bar into the row holding
 *    its close is the common shortcut and it visibly distorts the profile on
 *    high timeframes, where one bar can span a third of the ladder.
 *
 * Everything is pure so the binning and the value-area walk can be tested
 * without a chart.
 */

import type { Candle } from "@/lib/binance/types";

/** How the row height is decided. */
export type VpRowsLayout = "rows" | "ticks";

/** What the bar length encodes. */
export type VpVolumeMode = "updown" | "total" | "delta";

/** Which side of the pane the histogram is anchored to. */
export type VpPlacement = "right" | "left";

export interface VpOptions {
  /** "rows": `rowSize` is the row count. "ticks": `rowSize` is ticks per row. */
  rowsLayout: VpRowsLayout;
  rowSize: number;
  /** Price increment of the symbol — only used by the "ticks" layout. */
  tickSize?: number;
  /** Share of total volume the value area must cover, 0–100. */
  valueAreaPct: number;
}

export interface VpRow {
  /** Price bounds of the row. */
  low: number;
  high: number;
  /** Volume traded on up bars / down bars / both. */
  up: number;
  down: number;
  total: number;
  /** Row belongs to the value area (the `valueAreaPct` band around the POC). */
  inValueArea: boolean;
}

export interface VpResult {
  rows: VpRow[];
  /** Largest `total` across rows — the scale every bar length is relative to. */
  maxTotal: number;
  /** Index into `rows` of the point of control, and its mid price. */
  pocIndex: number;
  pocPrice: number;
  /** Value-area high / low prices (row edges, not mids). */
  vaHigh: number;
  vaLow: number;
  priceMin: number;
  priceMax: number;
  totalVolume: number;
}

/** Hard ceiling on rows so a silly tick size can't melt the browser. */
const MAX_ROWS = 500;

/**
 * Number of rows the options ask for over a given price span, clamped to
 * something a screen can actually show.
 */
export function rowCountFor(span: number, opts: VpOptions): number {
  if (opts.rowsLayout === "ticks") {
    const tick = opts.tickSize && opts.tickSize > 0 ? opts.tickSize : span / 100;
    const perRow = Math.max(1, Math.round(opts.rowSize));
    return Math.min(MAX_ROWS, Math.max(1, Math.round(span / (tick * perRow))));
  }
  return Math.min(MAX_ROWS, Math.max(1, Math.round(opts.rowSize)));
}

/**
 * Bin `candles` into a price ladder.
 * Returns null when there is nothing to draw (no candles, or a flat range).
 */
export function volumeProfile(candles: Candle[], opts: VpOptions): VpResult | null {
  if (candles.length === 0) return null;

  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (const c of candles) {
    if (c.low < priceMin) priceMin = c.low;
    if (c.high > priceMax) priceMax = c.high;
  }
  const span = priceMax - priceMin;
  if (!isFinite(span) || span <= 0) return null;

  const rowCount = rowCountFor(span, opts);
  const binSize = span / rowCount;
  const up = new Array<number>(rowCount).fill(0);
  const down = new Array<number>(rowCount).fill(0);

  for (const c of candles) {
    const bucket = c.close >= c.open ? up : down;
    const barRange = c.high - c.low;
    const first = clampIndex(Math.floor((c.low - priceMin) / binSize), rowCount);
    const last = clampIndex(Math.floor((c.high - priceMin) / binSize), rowCount);
    if (barRange === 0 || first === last) {
      // A bar with no range (or one that fits inside a single row) lands whole.
      bucket[first] += c.volume;
      continue;
    }
    for (let i = first; i <= last; i++) {
      const rowLow = priceMin + i * binSize;
      const rowHigh = rowLow + binSize;
      const overlap = Math.min(c.high, rowHigh) - Math.max(c.low, rowLow);
      if (overlap <= 0) continue;
      bucket[i] += c.volume * (overlap / barRange);
    }
  }

  const rows: VpRow[] = [];
  let maxTotal = 0;
  let pocIndex = 0;
  let totalVolume = 0;
  for (let i = 0; i < rowCount; i++) {
    const total = up[i] + down[i];
    totalVolume += total;
    if (total > maxTotal) {
      maxTotal = total;
      pocIndex = i;
    }
    rows.push({
      low: priceMin + i * binSize,
      high: priceMin + (i + 1) * binSize,
      up: up[i],
      down: down[i],
      total,
      inValueArea: false,
    });
  }
  if (maxTotal <= 0) return null;

  const { lo, hi } = valueAreaBounds(rows.map((r) => r.total), pocIndex, opts.valueAreaPct, totalVolume);
  for (let i = lo; i <= hi; i++) rows[i].inValueArea = true;

  return {
    rows,
    maxTotal,
    pocIndex,
    pocPrice: (rows[pocIndex].low + rows[pocIndex].high) / 2,
    vaHigh: rows[hi].high,
    vaLow: rows[lo].low,
    priceMin,
    priceMax,
    totalVolume,
  };
}

/**
 * Market-profile value area: start at the POC and keep absorbing whichever
 * *pair* of rows — the two above or the two below — carries more volume, until
 * the requested share of total volume is inside. Comparing pairs rather than
 * single rows is what the original Market Profile definition specifies, and it
 * produces a visibly different band than a greedy single-row walk on a profile
 * with two nearby peaks.
 */
export function valueAreaBounds(
  totals: number[],
  pocIndex: number,
  valueAreaPct: number,
  totalVolume: number,
): { lo: number; hi: number } {
  let lo = pocIndex;
  let hi = pocIndex;
  if (totals.length === 0) return { lo: 0, hi: 0 };
  const target = (totalVolume * Math.min(100, Math.max(0, valueAreaPct))) / 100;
  let acc = totals[pocIndex];

  while (acc < target && (lo > 0 || hi < totals.length - 1)) {
    const aboveA = hi + 1 < totals.length ? totals[hi + 1] : -1;
    const aboveB = hi + 2 < totals.length ? totals[hi + 2] : 0;
    const belowA = lo - 1 >= 0 ? totals[lo - 1] : -1;
    const belowB = lo - 2 >= 0 ? totals[lo - 2] : 0;
    const aboveSum = aboveA < 0 ? -1 : aboveA + aboveB;
    const belowSum = belowA < 0 ? -1 : belowA + belowB;
    if (aboveSum < 0 && belowSum < 0) break;

    if (aboveSum >= belowSum) {
      hi = Math.min(totals.length - 1, hi + 2);
      acc += aboveA + aboveB;
    } else {
      lo = Math.max(0, lo - 2);
      acc += belowA + belowB;
    }
  }
  return { lo, hi };
}

export interface DevelopingPocPoint {
  time: number;
  price: number;
}

/**
 * Developing POC — the point of control of the profile as it stood at each bar.
 * The ladder is fixed to the whole range's bounds so the line is comparable
 * bar to bar; only the accumulation grows.
 */
export function developingPoc(candles: Candle[], opts: VpOptions): DevelopingPocPoint[] {
  if (candles.length === 0) return [];
  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (const c of candles) {
    if (c.low < priceMin) priceMin = c.low;
    if (c.high > priceMax) priceMax = c.high;
  }
  const span = priceMax - priceMin;
  if (!isFinite(span) || span <= 0) return [];

  const rowCount = rowCountFor(span, opts);
  const binSize = span / rowCount;
  const totals = new Array<number>(rowCount).fill(0);
  const out: DevelopingPocPoint[] = [];
  let pocIndex = 0;
  let pocValue = 0;

  for (const c of candles) {
    const barRange = c.high - c.low;
    const first = clampIndex(Math.floor((c.low - priceMin) / binSize), rowCount);
    const last = clampIndex(Math.floor((c.high - priceMin) / binSize), rowCount);
    if (barRange === 0 || first === last) {
      totals[first] += c.volume;
    } else {
      for (let i = first; i <= last; i++) {
        const rowLow = priceMin + i * binSize;
        const overlap = Math.min(c.high, rowLow + binSize) - Math.max(c.low, rowLow);
        if (overlap > 0) totals[i] += c.volume * (overlap / barRange);
      }
    }
    // Only the rows this bar touched can have taken the lead.
    for (let i = first; i <= last; i++) {
      if (totals[i] > pocValue) {
        pocValue = totals[i];
        pocIndex = i;
      }
    }
    out.push({ time: c.time, price: priceMin + (pocIndex + 0.5) * binSize });
  }
  return out;
}

function clampIndex(i: number, rowCount: number): number {
  if (i < 0) return 0;
  if (i > rowCount - 1) return rowCount - 1;
  return i;
}
