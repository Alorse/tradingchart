"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { ArrowDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: ArrowDrawing;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function ArrowDraw({
  drawing,
  ax,
  ay,
  bx,
  by,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const color = drawing.color ?? TV_PINE.blue;
  const strokeWidth = drawing.lineWidth ?? 1.5;
  const strokeDasharray = drawing.lineStyle === 1 ? "6 4" : drawing.lineStyle === 2 ? "2 4" : undefined;
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<ArrowDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "arrow") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { a: pt } as Partial<ArrowDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { b: pt } as Partial<ArrowDrawing>),
    onEnd: commitEnd,
  });
  const dragLine = useDragShape<ArrowDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => ({
      a: { time: orig.a.time + dt, price: orig.a.price + dp },
      b: { time: orig.b.time + dt, price: orig.b.price + dp },
    }),
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "arrow" ? (current as ArrowDrawing) : null;
    },
    {
      onStart: snap,
      onMove: (patch) => updateLive(drawing.id, patch as Partial<ArrowDrawing>),
      onEnd: commitEnd,
    },
  );

  // Arrowhead geometry at B, pointing along A→B.
  const angle = Math.atan2(by - ay, bx - ax);
  const headLen = 8 + strokeWidth * 2;
  const spread = Math.PI / 7;
  const h1x = bx - headLen * Math.cos(angle - spread);
  const h1y = by - headLen * Math.sin(angle - spread);
  const h2x = bx - headLen * Math.cos(angle + spread);
  const h2y = by - headLen * Math.sin(angle + spread);

  return (
    <g>
      <line
        x1={ax}
        x2={bx}
        y1={ay}
        y2={by}
        stroke="transparent"
        strokeWidth={10}
        className="drawing-hit"
        style={{ pointerEvents: "stroke", cursor: selected ? "move" : "pointer" }}
        onMouseDown={(e) => {
          if (selected) {
            dragLine(e);
          } else {
            e.stopPropagation();
            onSelect();
          }
        }}
        onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}
      />
      <line
        x1={ax}
        x2={bx}
        y1={ay}
        y2={by}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        style={{ pointerEvents: "none" }}
      />
      {/* Solid arrowhead drawn as a filled triangle (marker avoids dash issues). */}
      <polygon
        points={`${bx},${by} ${h1x},${h1y} ${h2x},${h2y}`}
        fill={color}
        style={{ pointerEvents: "none" }}
      />
      {selected && (
        <>
          <DrawHandle x={ax} y={ay} color={color} selected onMouseDown={dragA} />
          <DrawHandle x={bx} y={by} color={color} selected onMouseDown={dragB} />
        </>
      )}
    </g>
  );
}
