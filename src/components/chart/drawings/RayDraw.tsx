"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { RayDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { extendRay } from "@/lib/drawings/geometry";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: RayDrawing;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function RayDraw({
  drawing,
  ax,
  ay,
  bx,
  by,
  width,
  height,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const color = drawing.color ?? TV_PINE.blue;
  const stroke = color;
  const strokeWidth = drawing.lineWidth ?? 1.5;
  const strokeDasharray = drawing.lineStyle === 1 ? "6 4" : drawing.lineStyle === 2 ? "2 4" : undefined;
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<RayDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "ray") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { a: pt } as Partial<RayDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { b: pt } as Partial<RayDrawing>),
    onEnd: commitEnd,
  });
  const dragLine = useDragShape<RayDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => ({
      a: { time: orig.a.time + dt, price: orig.a.price + dp },
      b: { time: orig.b.time + dt, price: orig.b.price + dp },
    }),
    () => {
      const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return c && c.kind === "ray" ? (c as RayDrawing) : null;
    },
    {
      onStart: snap,
      onMove: (patch) => updateLive(drawing.id, patch as Partial<RayDrawing>),
      onEnd: commitEnd,
    },
  );

  const end = extendRay({ x: ax, y: ay }, { x: bx, y: by }, width, height);

  return (
    <g>
      <line
        x1={ax}
        x2={end.x}
        y1={ay}
        y2={end.y}
        stroke="transparent"
        strokeWidth={10}
        className="drawing-hit"
        style={{
          pointerEvents: "stroke",
          cursor: selected ? "move" : "pointer",
          touchAction: "none",
        }}
        onPointerDown={(e) => {
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
        x2={end.x}
        y1={ay}
        y2={end.y}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        style={{ pointerEvents: "none" }}
      />
      {selected && (
        <>
          <DrawHandle x={ax} y={ay} color={color} selected onPointerDown={dragA} />
          <DrawHandle x={bx} y={by} color={color} selected onPointerDown={dragB} />
        </>
      )}
    </g>
  );
}
