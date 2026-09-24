"use client";

import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import type { DmiZoneSpan } from "@/lib/indicators/dmi-trade-zone";

interface Props {
  chart: IChartApi | null;
  /** Contiguous runs of bars where +DI > -DI, from `dmiZoneSpans`. */
  spans: DmiZoneSpan[];
  color: string;
  visible: boolean;
  /** Top / height of the DMI Trade Zone pane, in CSS px from the chart's top. */
  paneTop: number;
  paneHeight: number;
  /** Width of the plot area (excludes the right price scale) — clips the fill. */
  chartAreaWidth: number;
  /** Bumped on pan / zoom so the rects follow the canvas. */
  renderTick: number;
}

/**
 * Pine's `bgcolor(cond ? color.new(color.silver, 92) : na)` for the DMI Trade
 * Zone pane: the pane's full height shaded on every bar where +DI > -DI.
 *
 * An SVG overlay rather than a series primitive. lightweight-charts has no
 * background-fill series, and every other whole-pane fill here is already an
 * SVG sibling of the canvas — SqueezeOverlay, BandFillOverlay,
 * VolumeProfileOverlay — so this reuses `PriceChart`'s existing paneTop /
 * paneHeight geometry (which is what confines the fill to this pane instead of
 * letting it bleed into the price pane) and its `renderTick` pan/zoom pulse,
 * with no new rendering pattern introduced. A primitive would paint beneath
 * the series rather than over them, but at Pine's 8% alpha that ordering is
 * not perceptible, and it would be the codebase's only primitive.
 *
 * One rect per *run* rather than per bar: adjacent translucent rects seam
 * visibly where their alpha compounds along the shared edge.
 */
export function DmiTradeZoneOverlay({
  chart,
  spans,
  color,
  visible,
  paneTop,
  paneHeight,
  chartAreaWidth,
  renderTick,
}: Props) {
  void renderTick;
  if (!chart || !visible || spans.length === 0) return null;

  const ts = chart.timeScale();
  // Half a bar on each side, so a run covers its bars' full columns the way
  // Pine's bgcolor does, rather than stopping at their centres.
  const halfBar = Math.max(((ts.options() as { barSpacing?: number }).barSpacing ?? 6) / 2, 0.5);

  const rects: { x: number; width: number }[] = [];
  for (const span of spans) {
    const from = ts.timeToCoordinate(span.from as UTCTimestamp);
    const to = ts.timeToCoordinate(span.to as UTCTimestamp);
    if (from === null || to === null) continue;
    // Clamped to the plot area so a run scrolled half out of view keeps the
    // on-screen half at full width instead of being dropped by the clip path.
    const x1 = Math.max(from - halfBar, 0);
    const x2 = Math.min(to + halfBar, chartAreaWidth);
    if (x2 <= x1) continue;
    rects.push({ x: x1, width: x2 - x1 });
  }
  if (rects.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 z-[4]"
      style={{ top: paneTop, height: paneHeight, width: "100%" }}
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x.toFixed(2)}
          y={0}
          width={r.width.toFixed(2)}
          height={paneHeight}
          fill={color}
        />
      ))}
    </svg>
  );
}
