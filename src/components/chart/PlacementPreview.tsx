"use client";

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { DrawingTool } from "@/lib/store/chart-store";
import type { Candle } from "@/lib/binance/types";
import { timeToX } from "@/lib/chart/coords";
import { extendRay } from "@/lib/drawings/geometry";
import { TV_PINE } from "@/lib/chart/theme";

interface Point {
  time: number;
  price: number;
}

interface Props {
  tool: DrawingTool;
  first: Point | null;
  extra: Point[];
  cursor: Point | null;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  candles: Candle[];
  intervalSec: number;
  width: number;
  height: number;
}

const PREVIEW_STROKE = TV_PINE.white;
const PREVIEW_HANDLE = TV_PINE.blue;
const PREVIEW_DASH = "5 4";

/** Renders a thin dashed preview of the drawing being placed. */
export function PlacementPreview({
  tool,
  first,
  extra,
  cursor,
  chart,
  candleSeries,
  candles,
  intervalSec,
  width,
  height,
}: Props) {
  if (!chart || !candleSeries || !cursor) return null;

  const toX = (t: number): number | null =>
    timeToX(chart, t, candles, intervalSec);
  const toY = (p: number): number | null => {
    const y = candleSeries.priceToCoordinate(p);
    return y === null ? null : y;
  };

  if (!first) return null;

  const aX = toX(first.time);
  const aY = toY(first.price);
  const bX = toX(cursor.time);
  const bY = toY(cursor.price);

  if (tool === "trendline" || tool === "ray" || tool === "arrow" || tool === "callout") {
    if (aX === null || aY === null || bX === null || bY === null) return null;
    // For a ray, extend the segment through the cursor to the chart edge so
    // the user previews the full infinite line, not just the cursor segment.
    let endX = bX;
    let endY = bY;
    if (tool === "ray" && width > 0 && height > 0) {
      const end = extendRay({ x: aX, y: aY }, { x: bX, y: bY }, width, height);
      endX = end.x;
      endY = end.y;
    }
    return (
      <svg
        className="pointer-events-none absolute inset-0 z-20 h-full w-full"
        style={{ overflow: "visible" }}
      >
        <line
          x1={aX}
          y1={aY}
          x2={endX}
          y2={endY}
          stroke={PREVIEW_STROKE}
          strokeWidth={1.5}
        />
        <circle cx={aX} cy={aY} r={5} fill={PREVIEW_HANDLE} stroke={PREVIEW_STROKE} strokeWidth={1.5} />
        <circle cx={bX} cy={bY} r={4} fill="none" stroke={PREVIEW_HANDLE} strokeWidth={1.5} />
      </svg>
    );
  }

  if (tool === "long" || tool === "short") {
    if (aX === null || aY === null || bX === null || bY === null) return null;
    const entry = first.price;
    const target = cursor.price;
    const stop = entry - (target - entry);
    const eY = toY(entry);
    const tY = toY(target);
    const sY = toY(stop);
    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    const w = Math.max(right - left, 4);
    const targetColor = "rgba(38, 166, 154, 0.18)";
    const stopColor = "rgba(239, 83, 80, 0.18)";
    if (eY === null || tY === null || sY === null) return null;
    return (
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
        <rect
          x={left}
          y={Math.min(eY, tY)}
          width={w}
          height={Math.abs(tY - eY)}
          fill={targetColor}
          stroke={PREVIEW_STROKE}
          strokeDasharray={PREVIEW_DASH}
          strokeWidth={1}
        />
        <rect
          x={left}
          y={Math.min(eY, sY)}
          width={w}
          height={Math.abs(sY - eY)}
          fill={stopColor}
          stroke={PREVIEW_STROKE}
          strokeDasharray={PREVIEW_DASH}
          strokeWidth={1}
        />
        <circle cx={aX} cy={eY} r={3} fill={PREVIEW_STROKE} />
      </svg>
    );
  }

  if (tool === "price-range") {
    if (aX === null || aY === null || bX === null || bY === null) return null;
    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    const top = Math.min(aY, bY);
    const bottom = Math.max(aY, bY);
    return (
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
        <rect
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          fill="rgba(41, 98, 255, 0.10)"
          stroke={PREVIEW_STROKE}
          strokeDasharray={PREVIEW_DASH}
          strokeWidth={1}
        />
      </svg>
    );
  }

  if (tool === "date-range") {
    if (aX === null || bX === null) return null;
    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    return (
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
        <rect
          x={left}
          y={0}
          width={right - left}
          height={height}
          fill="rgba(41, 98, 255, 0.08)"
          stroke={PREVIEW_STROKE}
          strokeDasharray={PREVIEW_DASH}
          strokeWidth={1}
        />
      </svg>
    );
  }

  if (tool === "fib-retracement") {
    if (aX === null || aY === null || bX === null || bY === null) return null;
    const left = Math.min(aX, bX);
    const right = Math.max(aX, bX);
    const span = bY - aY;
    const lines = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((lv) => ({
      y: aY + span * lv,
      label: lv.toFixed(3),
    }));
    return (
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
        {lines.map((l, i) => (
          <line
            key={i}
            x1={left}
            x2={right}
            y1={l.y}
            y2={l.y}
            stroke={PREVIEW_STROKE}
            strokeWidth={1}
            strokeDasharray={PREVIEW_DASH}
            opacity={0.7}
          />
        ))}
      </svg>
    );
  }

  if (tool === "rectangle") {
    if (aX === null || aY === null || bX === null || bY === null) return null;
    const left = Math.min(aX, bX);
    const top = Math.min(aY, bY);
    const w = Math.abs(bX - aX);
    const h = Math.abs(bY - aY);
    return (
      <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" style={{ overflow: "visible" }}>
        <rect
          x={left} y={top} width={w} height={h}
          fill="rgba(41, 98, 255, 0.08)"
          stroke={PREVIEW_STROKE}
          strokeDasharray={PREVIEW_DASH}
          strokeWidth={1}
        />
        <circle cx={aX} cy={aY} r={4} fill={PREVIEW_HANDLE} stroke={PREVIEW_STROKE} strokeWidth={1.5} />
      </svg>
    );
  }

  if (tool === "fib-extension" || tool === "pitchfork" || tool === "xabcd") {
    const pts = [first, ...extra, cursor];
    const coords = pts.map((p) => ({ x: toX(p.time), y: toY(p.price) }));
    if (coords.some((c) => c.x === null || c.y === null)) return null;
    const pointsStr = coords.map((c) => `${c.x},${c.y}`).join(" ");
    return (
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
        <polyline
          points={pointsStr}
          fill="none"
          stroke={PREVIEW_STROKE}
          strokeWidth={1.5}
          strokeDasharray={PREVIEW_DASH}
        />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x as number} cy={c.y as number} r={3} fill={PREVIEW_STROKE} />
        ))}
      </svg>
    );
  }

  if (tool === "parallel-channel") {
    if (extra.length === 0) {
      if (aX === null || aY === null || bX === null || bY === null) return null;
      return (
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
          <line
            x1={aX}
            y1={aY}
            x2={bX}
            y2={bY}
            stroke={PREVIEW_STROKE}
            strokeWidth={1.5}
            strokeDasharray={PREVIEW_DASH}
          />
          <circle cx={aX} cy={aY} r={3} fill={PREVIEW_STROKE} />
        </svg>
      );
    } else {
      const b = extra[0];
      const baseX1 = toX(first.time);
      const baseY1 = toY(first.price);
      const baseX2 = toX(b.time);
      const baseY2 = toY(b.price);
      const cX = toX(cursor.time);
      const cY = toY(cursor.price);
      if (
        baseX1 === null || baseY1 === null ||
        baseX2 === null || baseY2 === null ||
        cX === null || cY === null
      ) return null;
      const dx = baseX2 - baseX1;
      const dy = baseY2 - baseY1;
      const slope = dx === 0 ? 0 : dy / dx;
      const offset = cY - (slope * (cX - baseX1) + baseY1);
      const pX1 = baseX1;
      const pY1 = baseY1 + offset;
      const pX2 = baseX2;
      const pY2 = baseY2 + offset;
      return (
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
          <line
            x1={baseX1}
            y1={baseY1}
            x2={baseX2}
            y2={baseY2}
            stroke={PREVIEW_STROKE}
            strokeWidth={1.5}
            strokeDasharray={PREVIEW_DASH}
          />
          <line
            x1={pX1}
            y1={pY1}
            x2={pX2}
            y2={pY2}
            stroke={PREVIEW_STROKE}
            strokeWidth={1.5}
            strokeDasharray={PREVIEW_DASH}
          />
          <circle cx={baseX1} cy={baseY1} r={3} fill={PREVIEW_STROKE} />
          <circle cx={baseX2} cy={baseY2} r={3} fill={PREVIEW_STROKE} />
        </svg>
      );
    }
  }

  return null;
}

interface MagnetProps {
  target: Point | null;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  candles: Candle[];
  intervalSec: number;
  width: number;
  height: number;
}

/** Small marker showing where Ctrl-snap will land. */
export function MagnetIndicator({
  target,
  chart,
  candleSeries,
  candles,
  intervalSec,
  width,
  height,
}: MagnetProps) {
  if (!target || !chart || !candleSeries) return null;
  const x = timeToX(chart, target.time, candles, intervalSec);
  const y = candleSeries.priceToCoordinate(target.price);
  if (x === null || y === null) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" style={{ overflow: "visible" }}>
      <circle cx={x} cy={y} r={5} fill="none" stroke={TV_PINE.snap} strokeWidth={2} />
      <circle cx={x} cy={y} r={2} fill={TV_PINE.snap} />
    </svg>
  );
}
