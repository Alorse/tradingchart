"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Drawing, FibExtensionDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { fibExtensionLevels } from "@/lib/drawings/fib";
import { formatPrice } from "@/lib/format";
import { translateDrawing } from "@/lib/drawings/translate";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: FibExtensionDrawing;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

const LEVEL_COLORS: Record<string, string> = {
  "0": TV_PINE.fibGray,
  "0.382": TV_PINE.fibOrange,
  "0.618": TV_PINE.blue,
  "1": TV_PINE.fibGray,
  "1.618": TV_PINE.green,
  "2.618": TV_PINE.fibPurple,
};

export function FibExtensionDraw({
  drawing,
  ax,
  ay,
  bx,
  by,
  cx,
  cy,
  width,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<FibExtensionDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "fib-extension") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { a: pt } as Partial<FibExtensionDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { b: pt } as Partial<FibExtensionDrawing>),
    onEnd: commitEnd,
  });
  const dragC = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { c: pt } as Partial<FibExtensionDrawing>),
    onEnd: commitEnd,
  });
  const dragShape = useDragShape<FibExtensionDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => translateDrawing(orig as Drawing, dt, dp) as Partial<FibExtensionDrawing>,
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "fib-extension" ? current : null;
    },
    { onStart: snap, onMove: (patch) => updateLive(drawing.id, patch), onEnd: commitEnd },
  );

  const levels = fibExtensionLevels(drawing.a.price, drawing.b.price, drawing.c.price, drawing.levels);
  // Levels are drawn from C's x to the right edge of the chart.
  const left = cx;
  const right = width;

  return (
    <g>
      {/* A→B→C guide segments (also the clickable hit area) */}
      <polyline
        points={`${ax},${ay} ${bx},${by} ${cx},${cy}`}
        fill="none"
        stroke={drawing.color ?? TV_PINE.fibGray}
        strokeWidth={selected ? 1.5 : 1}
        strokeDasharray="4 3"
        className="drawing-hit"
        style={{ pointerEvents: "stroke", cursor: selected ? "move" : "pointer", touchAction: "none" }}
        onPointerDown={(e) => {
          if (selected) {
            dragShape(e);
          } else {
            e.stopPropagation();
            onSelect();
          }
        }}
        onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}
      />
      {levels.map((lvl) => {
        const y = candleSeries?.priceToCoordinate(lvl.price) ?? null;
        if (y === null) return null;
        const label = lvl.ratio === 0 ? "0" : lvl.ratio === 1 ? "1" : String(lvl.ratio);
        const color = LEVEL_COLORS[label] ?? TV_PINE.fibGray;
        return (
          <g key={lvl.ratio}>
            <line
              x1={left}
              x2={right}
              y1={y}
              y2={y}
              stroke={color}
              strokeWidth={1}
              opacity={selected ? 1 : 0.85}
              style={{ pointerEvents: "none" }}
            />
            <text
              x={left + 4}
              y={y - 3}
              fill={color}
              fontSize={11}
              fontFamily="var(--font-mono), monospace"
              style={{ pointerEvents: "none" }}
            >
              {`${lvl.ratio}  ${formatPrice(lvl.price)}`}
            </text>
          </g>
        );
      })}
      {selected && (
        <>
          <DrawHandle x={ax} y={ay} color={TV_PINE.blue} selected onPointerDown={dragA} />
          <DrawHandle x={bx} y={by} color={TV_PINE.blue} selected onPointerDown={dragB} />
          <DrawHandle x={cx} y={cy} color={TV_PINE.blue} selected onPointerDown={dragC} />
        </>
      )}
    </g>
  );
}
