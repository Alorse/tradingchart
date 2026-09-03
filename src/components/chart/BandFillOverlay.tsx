"use client";

import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { BandPoint } from "@/lib/indicators";

interface Props {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  pts: BandPoint[];
  color: string;
  opacity: number;
  /** Height of the main pane — the fill must not bleed into a sub-pane. */
  mainPaneHeight: number;
  /** Pixel width of the plot area (excludes the right price scale). */
  chartAreaWidth: number;
}

/**
 * Translucent fill between the two rails of a banded overlay (Bollinger, VWAP
 * deviation bands).
 *
 * lightweight-charts has no band series, and the usual workaround — two area
 * series stacked with a transparent one on top — cannot express "fill only
 * between these two lines" once the price scale is logarithmic or inverted.
 * Sampling both rails through `priceToCoordinate` and closing one polygon is
 * both simpler and correct under every scale mode.
 */
export function BandFillOverlay({
  chart,
  candleSeries,
  pts,
  color,
  opacity,
  mainPaneHeight,
  chartAreaWidth,
}: Props) {
  if (!chart || !candleSeries || pts.length < 2) return null;

  const ts = chart.timeScale();
  const upper: string[] = [];
  const lower: string[] = [];

  for (const p of pts) {
    const x = ts.timeToCoordinate(p.time as UTCTimestamp);
    if (x === null) continue;
    // Everything off-screen still needs its two neighbours, so clip on x only
    // loosely — a point a little past the edge keeps the polygon closed.
    if ((x as number) < -50 || (x as number) > chartAreaWidth + 50) continue;
    const yu = candleSeries.priceToCoordinate(p.upper);
    const yl = candleSeries.priceToCoordinate(p.lower);
    if (yu === null || yl === null) continue;
    upper.push(`${(x as number).toFixed(1)},${(yu as number).toFixed(1)}`);
    lower.push(`${(x as number).toFixed(1)},${(yl as number).toFixed(1)}`);
  }
  if (upper.length < 2) return null;

  const d = `M ${upper.join(" L ")} L ${lower.reverse().join(" L ")} Z`;

  return (
    <svg
      className="pointer-events-none absolute z-[3]"
      style={{ top: 0, left: 0, width: "100%", height: mainPaneHeight }}
    >
      <path d={d} fill={color} fillOpacity={opacity} />
    </svg>
  );
}
