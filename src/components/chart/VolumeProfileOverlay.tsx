"use client";

import { useMemo } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/binance/types";
import type { VolumeProfileConfig } from "@/lib/store/chart-store";
import { developingPoc, volumeProfile, type VpResult } from "@/lib/indicators/volume-profile";
import { formatVolume } from "@/lib/format";

interface Props {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  /** The full candle array — the profile is built from the visible slice of it. */
  candles: Candle[];
  cfg: VolumeProfileConfig;
  /** Symbol tick size, for the "ticks per row" layout. */
  tickSize?: number;
  /** Pixel width of the plot area (excludes the right price scale). */
  chartAreaWidth: number;
  /** Height of the main pane — the profile never spills into a sub-pane. */
  mainPaneHeight: number;
  /** Bumped by the chart on every pan/zoom/tick, forcing a recompute. */
  renderTick: number;
}

/** Rows shorter than this can't fit a readable number next to them. */
const MIN_LABEL_ROW_PX = 9;

/**
 * Volume Profile — Visible Range (VRVP).
 *
 * Drawn as an SVG overlay rather than a lightweight-charts series because the
 * histogram is indexed by *price*, across the whole time axis: there is no
 * series type for a horizontal bar chart pinned to the price scale. The
 * geometry is derived the same way every other overlay here derives it —
 * `timeScale().width()` for where the plot ends, `priceToCoordinate` for the
 * row edges — so it stays glued to the candles through any pan or zoom.
 */
export function VolumeProfileOverlay({
  chart,
  candleSeries,
  candles,
  cfg,
  tickSize,
  chartAreaWidth,
  mainPaneHeight,
  renderTick,
}: Props) {
  // Visible range drives everything; read it fresh on each render (PriceChart
  // re-renders on every range change) and use it as the memo key.
  const range = chart?.timeScale().getVisibleRange() ?? null;
  const from = range ? Number(range.from) : 0;
  const to = range ? Number(range.to) : 0;
  // WS ticks mutate the candle array in place, so neither its identity nor its
  // length changes while the live bar fills up — the running volume of the last
  // bar is what tells the memo the profile moved.
  const liveVolume = candles.length > 0 ? candles[candles.length - 1].volume : 0;

  const profile: VpResult | null = useMemo(() => {
    if (!range || candles.length === 0) return null;
    const slice = candles.filter((c) => c.time >= from && c.time <= to);
    if (slice.length === 0) return null;
    return volumeProfile(slice, {
      rowsLayout: cfg.rowsLayout,
      rowSize: cfg.rowSize,
      tickSize,
      valueAreaPct: cfg.valueAreaPct,
    });
    // `renderTick` is the signal that the candles array mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, from, to, liveVolume, cfg.rowsLayout, cfg.rowSize, cfg.valueAreaPct, tickSize, renderTick]);

  const devPoc = useMemo(() => {
    if (!cfg.showDevelopingPoc || !range || candles.length === 0) return [];
    const slice = candles.filter((c) => c.time >= from && c.time <= to);
    if (slice.length === 0) return [];
    return developingPoc(slice, {
      rowsLayout: cfg.rowsLayout,
      rowSize: cfg.rowSize,
      tickSize,
      valueAreaPct: cfg.valueAreaPct,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, from, to, liveVolume, cfg.showDevelopingPoc, cfg.rowsLayout, cfg.rowSize, cfg.valueAreaPct, tickSize, renderTick]);

  if (!chart || !candleSeries || !profile || chartAreaWidth <= 0) return null;

  const maxBarPx = Math.max(8, (chartAreaWidth * Math.min(100, Math.max(1, cfg.widthPct))) / 100);
  const anchorRight = cfg.placement === "right";
  /** Turn a bar length into its left edge x, honouring the placement side. */
  const xStart = (len: number) => (anchorRight ? chartAreaWidth - len : 0);

  type DrawnRow = {
    y: number;
    h: number;
    segments: { x: number; w: number; fill: string }[];
    label?: { x: number; text: string; anchor: "start" | "end" };
  };

  const rows: DrawnRow[] = [];
  for (const row of profile.rows) {
    if (row.total <= 0) continue;
    const yTop = candleSeries.priceToCoordinate(row.high);
    const yBottom = candleSeries.priceToCoordinate(row.low);
    if (yTop === null || yBottom === null) continue;
    const y = yTop as number;
    const rawH = (yBottom as number) - y;
    if (y > mainPaneHeight || y + rawH < 0) continue;
    // Leave a hairline between rows so the ladder reads as bars, not a block.
    const h = Math.max(1, rawH - (rawH > 3 ? 1 : 0));

    // Value-area rows read as "solid", the rest as background — but both are
    // driven off the one opacity slider, so turning the profile down never
    // leaves an opaque block sitting on top of the candles.
    const inVa = row.inValueArea;
    const vaAlpha = Math.min(0.85, cfg.opacity + 0.3);
    const upFill = withAlpha(inVa ? cfg.valueAreaUpColor : cfg.upColor, inVa ? vaAlpha : cfg.opacity);
    const downFill = withAlpha(
      inVa ? cfg.valueAreaDownColor : cfg.downColor,
      inVa ? vaAlpha : cfg.opacity,
    );

    const segments: DrawnRow["segments"] = [];
    let barLen = 0;
    if (cfg.volumeMode === "delta") {
      const delta = row.up - row.down;
      barLen = (Math.abs(delta) / profile.maxTotal) * maxBarPx;
      segments.push({ x: xStart(barLen), w: barLen, fill: delta >= 0 ? upFill : downFill });
    } else if (cfg.volumeMode === "total") {
      barLen = (row.total / profile.maxTotal) * maxBarPx;
      const fill = withAlpha(cfg.totalColor, inVa ? vaAlpha : cfg.opacity);
      segments.push({ x: xStart(barLen), w: barLen, fill });
    } else {
      barLen = (row.total / profile.maxTotal) * maxBarPx;
      const upLen = (row.up / profile.maxTotal) * maxBarPx;
      const downLen = barLen - upLen;
      // Up volume sits against the price scale, down volume continues outward —
      // the same reading order TradingView uses for its Up/Down mode.
      if (anchorRight) {
        segments.push({ x: chartAreaWidth - upLen, w: upLen, fill: upFill });
        segments.push({ x: chartAreaWidth - barLen, w: downLen, fill: downFill });
      } else {
        segments.push({ x: 0, w: upLen, fill: upFill });
        segments.push({ x: upLen, w: downLen, fill: downFill });
      }
    }

    const drawn: DrawnRow = {
      y,
      h,
      segments: segments.filter((s) => s.w > 0.2),
    };
    if (cfg.showValues && h >= MIN_LABEL_ROW_PX) {
      const value = cfg.volumeMode === "delta" ? row.up - row.down : row.total;
      drawn.label = anchorRight
        ? { x: xStart(barLen) - 4, text: formatVolume(value), anchor: "end" }
        : { x: barLen + 4, text: formatVolume(value), anchor: "start" };
    }
    rows.push(drawn);
  }

  // The POC row is by definition the longest bar, so its marker spans the full
  // histogram width; "extend right" stretches it across the whole plot instead.
  const pocY = candleSeries.priceToCoordinate(profile.pocPrice);
  const pocX1 = cfg.extendPocRight ? 0 : xStart(maxBarPx);
  const pocX2 = cfg.extendPocRight ? chartAreaWidth : xStart(maxBarPx) + maxBarPx;

  const ts = chart.timeScale();
  let devPath = "";
  for (const p of devPoc) {
    const x = ts.timeToCoordinate(p.time as UTCTimestamp);
    const y = candleSeries.priceToCoordinate(p.price);
    if (x === null || y === null) continue;
    devPath += `${devPath ? "L" : "M"} ${(x as number).toFixed(1)},${(y as number).toFixed(1)} `;
  }

  return (
    <svg
      className="pointer-events-none absolute z-[4]"
      style={{ top: 0, left: 0, width: "100%", height: mainPaneHeight }}
    >
      {rows.map((r, i) => (
        <g key={i}>
          {r.segments.map((s, j) => (
            <rect key={j} x={s.x} y={r.y} width={s.w} height={r.h} fill={s.fill} />
          ))}
          {r.label && (
            <text
              x={r.label.x}
              y={r.y + r.h / 2 + 3}
              fontSize={11}
              fill="var(--color-tv-text-muted)"
              textAnchor={r.label.anchor}
              fontFamily="var(--font-mono), monospace"
            >
              {r.label.text}
            </text>
          )}
        </g>
      ))}
      {devPath && (
        <path d={devPath} fill="none" stroke={cfg.developingPocColor} strokeWidth={1} opacity={0.8} />
      )}
      {pocY !== null && (
        <line
          x1={pocX1}
          x2={pocX2}
          y1={pocY as number}
          y2={pocY as number}
          stroke={cfg.pocColor}
          strokeWidth={cfg.pocLineWidth}
        />
      )}
    </svg>
  );
}

/**
 * Apply an alpha to a `#rrggbb` colour. Rows are drawn translucent so the
 * candles stay readable underneath, and the stored config keeps plain hex so
 * the colour pickers can round-trip it.
 */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
