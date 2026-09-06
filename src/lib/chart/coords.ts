/**
 * Time / pixel coordinate helpers that support extrapolation past the last
 * candle. Lightweight-charts' built-in `timeToCoordinate` and `coordinateToTime`
 * return null for positions outside the data range, but for drawings we want
 * to place anchors in the "future" zone of the right-offset area.
 */

import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import type { Candle, Timeframe } from "@/lib/binance/types";

// Module scope, not rebuilt per call: `timeframeToSeconds` runs inside
// pointermove handlers and per-drawing render loops, where allocating a
// 15-key object per call is pure garbage.
const TF_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "8h": 28800,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
  "1M": 2592000,
};

export function timeframeToSeconds(tf: Timeframe): number {
  return TF_SECONDS[tf] ?? 60;
}

/**
 * Short label for a timeframe, matching TradingView's casing convention:
 * minutes/hours keep their lowercase unit (1m, 4h) while day/week/month
 * collapse to a single uppercase letter (D, W, M) — so a CSS `uppercase`
 * transform on this string (as some callers used to apply blindly) doesn't
 * turn "1m"/"4h" into "1M"/"4H", which reads as months/nonsense.
 */
export function timeframeLabel(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "6h": "6h",
    "8h": "8h",
    "12h": "12h",
    "1d": "D",
    "3d": "3D",
    "1w": "W",
    "1M": "M",
  };
  return map[tf] ?? tf;
}

/**
 * Convert a pixel x-coordinate to a unix-second timestamp. Handles positions
 * past the last candle by extrapolating using the timeframe's interval.
 */
export function xToTime(
  chart: IChartApi,
  x: number,
  candles: Candle[],
  intervalSec: number,
): number | null {
  if (candles.length === 0) return null;
  const logical = chart.timeScale().coordinateToLogical(x);
  if (logical === null) return null;
  const lastIdx = candles.length - 1;
  if (logical >= 0 && logical <= lastIdx) {
    // Sub-bar precision: interpolate between neighboring candle timestamps
    // so brush strokes don't snap to candle boundaries (staircase effect).
    const i = Math.min(Math.floor(logical), lastIdx - 1);
    const frac = logical - i;
    return candles[i].time + frac * (candles[i + 1].time - candles[i].time);
  }
  if (logical > lastIdx) {
    const barsAhead = logical - lastIdx;
    return candles[lastIdx].time + barsAhead * intervalSec;
  }
  // logical < 0
  const barsBefore = -logical;
  return candles[0].time - barsBefore * intervalSec;
}

/**
 * Convert a fractional logical index to a pixel x-coordinate.
 *
 * Public `logicalToCoordinate()` only accepts integers — the underlying
 * `indexToCoordinate` returns 0 for fractional logicals, which would stack
 * every off-grid anchor on the left edge of the chart. Drawing anchors are
 * timestamps that usually don't sit on the charted timeframe's bar grid
 * (a drawing made on 1h has half-hour-offset anchors once the chart flips
 * to 4h), so we interpolate linearly between the two neighbouring bars,
 * which is exactly what the integer mapping does between whole bars.
 */
export function fractionalLogicalToX(
  chart: IChartApi,
  logical: number,
): number | null {
  if (!Number.isFinite(logical)) return null;
  const xLo = chart.timeScale().logicalToCoordinate(Math.floor(logical) as never);
  if (xLo === null) return null;
  const frac = logical - Math.floor(logical);
  if (frac === 0) return xLo;
  const xHi = chart.timeScale().logicalToCoordinate((Math.floor(logical) + 1) as never);
  if (xHi === null) return xLo;
  return xLo + frac * (xHi - xLo);
}

/**
 * Convert a unix-second timestamp to a pixel x-coordinate. Handles timestamps
 * past the last candle by using the logical-to-coordinate mapping.
 */
export function timeToX(
  chart: IChartApi,
  t: number,
  candles: Candle[],
  intervalSec: number,
): number | null {
  const direct = chart.timeScale().timeToCoordinate(t as UTCTimestamp);
  if (direct !== null) return direct;
  if (candles.length === 0) return null;
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (t > last.time) {
    const barsAhead = (t - last.time) / intervalSec;
    return fractionalLogicalToX(chart, candles.length - 1 + barsAhead);
  }
  if (t < first.time) {
    const barsBefore = (first.time - t) / intervalSec;
    return fractionalLogicalToX(chart, -barsBefore);
  }
  // Fractional timestamp between existing candles (e.g. brush strokes).
  // Approximate logical position via interval spacing.
  const logical = (t - first.time) / intervalSec;
  return fractionalLogicalToX(chart, logical);
}
