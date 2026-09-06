"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { RectangleDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { TV_PINE } from "@/lib/chart/theme";
import { lineDash } from "@/lib/drawings/line-style";

interface Props {
  drawing: RectangleDrawing;
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

export function RectangleDraw({
  drawing,
  ax, ay, bx, by,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<RectangleDrawing | null>(null);

  function snap() {
    const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (c && c.kind === "rectangle") snapshotRef.current = c;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { a: pt } as Partial<RectangleDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { b: pt } as Partial<RectangleDrawing>),
    onEnd: commitEnd,
  });
  const dragRect = useDragShape<RectangleDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => ({
      a: { time: orig.a.time + dt, price: orig.a.price + dp },
      b: { time: orig.b.time + dt, price: orig.b.price + dp },
    }),
    () => {
      const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return c && c.kind === "rectangle" ? c : null;
    },
    { onStart: snap, onMove: (p) => updateLive(drawing.id, p as Partial<RectangleDrawing>), onEnd: commitEnd },
  );

  const borderColor = drawing.color ?? TV_PINE.blue;
  const stroke = borderColor;
  const strokeWidth = drawing.lineWidth ?? 1;
  const strokeDasharray = lineDash(drawing.lineStyle);
  const fillBase = drawing.fillColor ?? borderColor;
  const fillOpacity = drawing.fillOpacity ?? 0.1;

  const left = Math.min(ax, bx);
  const top = Math.min(ay, by);
  const w = Math.abs(bx - ax);
  const h = Math.abs(by - ay);

  return (
    <g>
      {/* Transparent fill hit area for body drag */}
      <rect
        x={left} y={top} width={w} height={h}
        fill="transparent"
        stroke="none"
        className="drawing-hit"
        style={{ cursor: selected ? "move" : "pointer", pointerEvents: "all", touchAction: "none" }}
        onPointerDown={(e) => {
          if (drawing.locked) return;
          if (selected) {
            dragRect(e);
          } else {
            e.stopPropagation();
            onSelect();
          }
        }}
        onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}
      />
      {/* Fill */}
      <rect
        x={left} y={top} width={w} height={h}
        fill={fillBase}
        fillOpacity={fillOpacity}
        stroke="none"
        style={{ pointerEvents: "none" }}
      />
      {/* Border */}
      <rect
        x={left} y={top} width={w} height={h}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        style={{ pointerEvents: "none" }}
      />
      {/* Corner handles */}
      {selected && (
        <>
          <DrawHandle x={ax} y={ay} color={borderColor} selected onPointerDown={dragA} />
          <DrawHandle x={bx} y={by} color={borderColor} selected onPointerDown={dragB} />
          <DrawHandle x={bx} y={ay} color={borderColor} selected onPointerDown={(e) => {
            snap();
            dragB(e);
          }} />
          <DrawHandle x={ax} y={by} color={borderColor} selected onPointerDown={(e) => {
            snap();
            dragA(e);
          }} />
        </>
      )}
    </g>
  );
}
