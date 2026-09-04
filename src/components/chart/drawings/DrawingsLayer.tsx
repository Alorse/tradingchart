"use client";

import { useEffect, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useChartStore } from "@/lib/store/chart-store";
import { timeToX, fractionalLogicalToX, timeframeToSeconds } from "@/lib/chart/coords";
import { candlesRef as globalCandlesRef } from "@/lib/chart/candles-ref";
import type { Drawing } from "@/lib/drawings/types";
import { HLineDraw } from "./HLineDraw";
import { VLineDraw } from "./VLineDraw";
import { HRayDraw } from "./HRayDraw";
import { TrendLineDraw } from "./TrendLineDraw";
import { RayDraw } from "./RayDraw";
import { ParallelChannelDraw } from "./ParallelChannelDraw";
import { FibRetracementDraw } from "./FibRetracementDraw";
import { PriceRangeDraw } from "./PriceRangeDraw";
import { DateRangeDraw } from "./DateRangeDraw";
import { PositionDraw } from "./PositionDraw";
import { BrushDraw } from "./BrushDraw";
import { RectangleDraw } from "./RectangleDraw";
import { ArrowDraw } from "./ArrowDraw";
import { TextDraw } from "./TextDraw";
import { FibExtensionDraw } from "./FibExtensionDraw";
import { PitchforkDraw } from "./PitchforkDraw";
import { CalloutDraw } from "./CalloutDraw";
import { XabcdDraw } from "./XabcdDraw";

interface Props {
  symbol: string;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
  width: number;
  height: number;
  /** Height of pane 0 (main chart). Drawings are clipped to this area. */
  mainPaneHeight?: number;
  /** Width of the chart drawing area (excludes right price scale). */
  chartAreaWidth?: number;
  /** Bumped whenever the chart pans/zooms so we re-render pixel coords */
  renderTick: number;
}

export function DrawingsLayer({
  symbol,
  chart,
  candleSeries,
  container,
  width,
  height,
  mainPaneHeight,
  chartAreaWidth,
  renderTick,
}: Props) {
  const drawings = useDrawingsStore((s) => s.drawings);
  const selectedId = useDrawingsStore((s) => s.selectedId);
  const setSelected = useDrawingsStore((s) => s.setSelected);
  const setEditing = useDrawingsStore((s) => s.setEditing);
  const tool = useChartStore((s) => s.tool);
  // When any drawing tool is active, disable hit areas so clicks pass through to the chart
  const drawingsPassive = tool !== "cursor" && tool !== "eraser";

  // Force re-render when symbol or renderTick changes
  const [, setTick] = useState(0);
  useEffect(() => {
    setTick((t) => t + 1);
  }, [renderTick, symbol]);

  if (!chart || !candleSeries) return null;

  const visible = drawings.filter((d) => d.symbol === symbol && !d.hidden);

  const clipH = mainPaneHeight ?? height;
  const clipW = chartAreaWidth && chartAreaWidth > 0 ? chartAreaWidth : width;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      style={{ overflow: "visible" }}
    >
      <defs>
        <clipPath id="drawings-main-pane">
          <rect x="0" y="0" width={clipW} height={clipH} />
        </clipPath>
      </defs>
      {/* Disable all drawing hit areas when a placement tool is active */}
      {drawingsPassive && (
        <style>{`.drawing-hit { pointer-events: none !important; }`}</style>
      )}
      <g clipPath="url(#drawings-main-pane)">
        {visible.map((d) =>
          renderDrawing({
            d,
            chart,
            candleSeries,
            container,
            width,
            height,
            intervalSec: timeframeToSeconds(useChartStore.getState().timeframe),
            selected: selectedId === d.id,
            onSelect: () => setSelected(d.id),
            onEdit: () => setEditing(d.id),
          }),
        )}
      </g>
    </svg>
  );
}

interface RenderArgs {
  d: Drawing;
  chart: IChartApi;
  candleSeries: ISeriesApi<"Candlestick">;
  container: HTMLElement | null;
  width: number;
  height: number;
  intervalSec: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

function renderDrawing(args: RenderArgs) {
  const { d, chart, candleSeries, container, width, height, selected, onSelect, onEdit } = args;
  const _intervalSec = args.intervalSec;
  switch (d.kind) {
    case "hline": {
      const y = candleSeries.priceToCoordinate(d.price);
      if (y === null) return null;
      return (
        <HLineDraw
          key={d.id}
          drawing={d}
          y={y}
          width={width}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "vline": {
      const x = timeToX(chart, Number(d.time), globalCandlesRef.current, _intervalSec);
      if (x === null) return null;
      return (
        <VLineDraw
          key={d.id}
          drawing={d}
          x={x}
          height={height}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "hray": {
      const x = timeToX(chart, Number(d.anchor.time), globalCandlesRef.current, _intervalSec);
      const y = candleSeries.priceToCoordinate(d.anchor.price);
      if (x === null || y === null) return null;
      return (
        <HRayDraw
          key={d.id}
          drawing={d}
          anchorX={x}
          y={y}
          width={width}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "trendline": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      if (ax === null || ay === null || bx === null || by === null) return null;
      return (
        <TrendLineDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "parallel-channel": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      const cx = timeToX(chart, Number(d.c.time), globalCandlesRef.current, _intervalSec);
      const cy = candleSeries.priceToCoordinate(d.c.price);
      if (ax === null || ay === null || bx === null || by === null || cx === null || cy === null) return null;
      return (
        <ParallelChannelDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          cx={cx}
          cy={cy}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "long":
    case "short": {
      const xA = timeToX(chart, Number(d.timeA), globalCandlesRef.current, _intervalSec);
      const yEntry = candleSeries.priceToCoordinate(d.entry);
      const yStop = candleSeries.priceToCoordinate(d.stop);
      const yTarget = candleSeries.priceToCoordinate(d.target);
      if (xA === null || yEntry === null || yStop === null || yTarget === null) {
        return null;
      }
      const barSpan = Math.max(1, (Number(d.timeB) - Number(d.timeA)) / _intervalSec);
      const logicalA = chart.timeScale().coordinateToLogical(xA);
      // `logicalA + barSpan` is fractional (a 1h-spanning position on a 4h chart
      // is 0.25 bars wide), so it must go through the interpolating helper — the
      // raw logicalToCoordinate() returns 0 for fractional logicals.
      const xB = logicalA !== null
        ? (fractionalLogicalToX(chart, logicalA + barSpan) ?? xA + barSpan * 8)
        : (timeToX(chart, Number(d.timeB), globalCandlesRef.current, _intervalSec) ?? xA + 100);
      return (
        <PositionDraw
          key={d.id}
          drawing={d}
          xA={xA}
          xB={xB}
          yEntry={yEntry}
          yStop={yStop}
          yTarget={yTarget}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "price-range": {
      const xA = timeToX(chart, Number(d.timeA), globalCandlesRef.current, _intervalSec);
      const xB = timeToX(chart, Number(d.timeB), globalCandlesRef.current, _intervalSec);
      const yA = candleSeries.priceToCoordinate(d.priceA);
      const yB = candleSeries.priceToCoordinate(d.priceB);
      if (xA === null || xB === null || yA === null || yB === null) return null;
      return (
        <PriceRangeDraw
          key={d.id}
          drawing={d}
          xA={xA}
          xB={xB}
          yA={yA}
          yB={yB}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "date-range": {
      const xA = timeToX(chart, Number(d.timeA), globalCandlesRef.current, _intervalSec);
      const xB = timeToX(chart, Number(d.timeB), globalCandlesRef.current, _intervalSec);
      if (xA === null || xB === null) return null;
      return (
        <DateRangeDraw
          key={d.id}
          drawing={d}
          xA={xA}
          xB={xB}
          height={height}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "fib-retracement": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      if (ax === null || ay === null || bx === null || by === null) return null;
      return (
        <FibRetracementDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "ray": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      if (ax === null || ay === null || bx === null || by === null) return null;
      return (
        <RayDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          width={width}
          height={height}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "brush":
    case "highlighter":
      return (
        <BrushDraw
          key={d.id}
          drawing={d}
          chart={chart}
          candleSeries={candleSeries}
          selected={selected}
          onSelect={onSelect}
        />
      );
    case "rectangle": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const by = candleSeries.priceToCoordinate(d.b.price);
      if (ax === null || bx === null || ay === null || by === null) return null;
      return (
        <RectangleDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "arrow": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      if (ax === null || ay === null || bx === null || by === null) return null;
      return (
        <ArrowDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "text": {
      const x = timeToX(chart, Number(d.anchor.time), globalCandlesRef.current, _intervalSec);
      const y = candleSeries.priceToCoordinate(d.anchor.price);
      if (x === null || y === null) return null;
      return (
        <TextDraw
          key={d.id}
          drawing={d}
          x={x}
          y={y}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "fib-extension": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      const cx = timeToX(chart, Number(d.c.time), globalCandlesRef.current, _intervalSec);
      const cy = candleSeries.priceToCoordinate(d.c.price);
      if (ax === null || ay === null || bx === null || by === null || cx === null || cy === null) return null;
      return (
        <FibExtensionDraw
          key={d.id}
          drawing={d}
          ax={ax}
          ay={ay}
          bx={bx}
          by={by}
          cx={cx}
          cy={cy}
          width={width}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "pitchfork": {
      const ax = timeToX(chart, Number(d.a.time), globalCandlesRef.current, _intervalSec);
      const ay = candleSeries.priceToCoordinate(d.a.price);
      const bx = timeToX(chart, Number(d.b.time), globalCandlesRef.current, _intervalSec);
      const by = candleSeries.priceToCoordinate(d.b.price);
      const cx = timeToX(chart, Number(d.c.time), globalCandlesRef.current, _intervalSec);
      const cy = candleSeries.priceToCoordinate(d.c.price);
      if (ax === null || ay === null || bx === null || by === null || cx === null || cy === null) return null;
      return (
        <PitchforkDraw
          key={d.id}
          drawing={d}
          ax={ax} ay={ay} bx={bx} by={by} cx={cx} cy={cy}
          width={width}
          height={height}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "callout": {
      const anchorX = timeToX(chart, Number(d.anchor.time), globalCandlesRef.current, _intervalSec);
      const anchorY = candleSeries.priceToCoordinate(d.anchor.price);
      const targetX = timeToX(chart, Number(d.target.time), globalCandlesRef.current, _intervalSec);
      const targetY = candleSeries.priceToCoordinate(d.target.price);
      if (anchorX === null || anchorY === null || targetX === null || targetY === null) return null;
      return (
        <CalloutDraw
          key={d.id}
          drawing={d}
          anchorX={anchorX} anchorY={anchorY} targetX={targetX} targetY={targetY}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    case "xabcd": {
      const pts = d.points.map((p) => ({
        x: timeToX(chart, Number(p.time), globalCandlesRef.current, _intervalSec),
        y: candleSeries.priceToCoordinate(p.price),
      }));
      if (pts.some((p) => p.x === null || p.y === null)) return null;
      return (
        <XabcdDraw
          key={d.id}
          drawing={d}
          pts={pts as { x: number; y: number }[]}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          chart={chart}
          candleSeries={candleSeries}
          container={container}
        />
      );
    }
    default:
      return null;
  }
}
