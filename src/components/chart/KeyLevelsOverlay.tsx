"use client";

import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { KeyLevel } from "@/lib/indicators/keylevels";

interface Props {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  levels: KeyLevel[];
  /** Pixel width of the chart drawing area (excludes the right price scale). */
  chartAreaWidth: number;
  /** Total chart height in pixels. */
  chartHeight: number;
  /** Height of the main (top) pane only — lines should not extend past it. */
  mainPaneHeight: number;
  /** "Small" | "Medium" | "Large" → label font-size in px. */
  textSize: "Small" | "Medium" | "Large";
  /** "Small" | "Medium" | "Large" → line stroke-width. */
  lineWidth: "Small" | "Medium" | "Large";
  /** Pixel distance from the right edge to draw the label/marker. */
  rightMargin: number;
}

const TEXT_PX: Record<Props["textSize"], number> = {
  Small: 11,
  Medium: 13,
  Large: 15,
};
const LINE_PX: Record<Props["lineWidth"], number> = {
  Small: 1,
  Medium: 2,
  Large: 3,
};

export function KeyLevelsOverlay({
  chart,
  candleSeries,
  levels,
  chartAreaWidth,
  mainPaneHeight,
  textSize,
  lineWidth,
  rightMargin,
}: Props) {
  if (!chart || !candleSeries || levels.length === 0) return null;

  const ts = chart.timeScale();
  const fontPx = TEXT_PX[textSize];
  const strokePx = LINE_PX[lineWidth];
  const labelXEnd = chartAreaWidth;        // labels sit at the right edge of plot area
  const lineXEnd = chartAreaWidth - 4;     // leave room for the label

  type Drawn = { yPx: number; level: KeyLevel; x1: number };
  const drawn: Drawn[] = [];

  for (const lvl of levels) {
    const yRaw = candleSeries.priceToCoordinate(lvl.price);
    if (yRaw === null) continue;
    const y = yRaw as number;
    // Skip levels outside the main pane (e.g. below the candles area).
    if (y < 0 || y > mainPaneHeight) continue;
    let x1 = ts.timeToCoordinate(lvl.startTime as UTCTimestamp) as number | null;
    if (x1 === null) x1 = 0;
    if (x1 < 0) x1 = 0;
    drawn.push({ yPx: y, level: lvl, x1 });
  }

  return (
    <svg
      className="pointer-events-none absolute z-[6]"
      style={{ top: 0, left: 0, width: "100%", height: mainPaneHeight }}
    >
      {drawn.map((d, i) => (
        <g key={i}>
          <line
            x1={d.x1}
            x2={lineXEnd}
            y1={d.yPx}
            y2={d.yPx}
            stroke={d.level.color}
            strokeWidth={strokePx}
            strokeOpacity={0.85}
          />
          <text
            x={labelXEnd - rightMargin}
            y={d.yPx - 2}
            fontSize={fontPx}
            fill={d.level.color}
            fontFamily="var(--font-mono), monospace"
            textAnchor="end"
          >
            {d.level.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
