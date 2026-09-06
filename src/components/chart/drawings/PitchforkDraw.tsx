"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Drawing, PitchforkDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { extendRay, midpoint } from "@/lib/drawings/geometry";
import { translateDrawing } from "@/lib/drawings/translate";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: PitchforkDrawing;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function PitchforkDraw({
  drawing,
  ax,
  ay,
  bx,
  by,
  cx,
  cy,
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
  const strokeWidth = drawing.lineWidth ?? 1.5;
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<PitchforkDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "pitchfork") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { a: pt } as Partial<PitchforkDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { b: pt } as Partial<PitchforkDrawing>),
    onEnd: commitEnd,
  });
  const dragC = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { c: pt } as Partial<PitchforkDrawing>),
    onEnd: commitEnd,
  });
  const dragShape = useDragShape<PitchforkDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => translateDrawing(orig as Drawing, dt, dp) as Partial<PitchforkDrawing>,
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "pitchfork" ? current : null;
    },
    { onStart: snap, onMove: (patch) => updateLive(drawing.id, patch), onEnd: commitEnd },
  );

  // Median: from A through the midpoint of B-C, extended to the edge.
  const m = midpoint({ x: bx, y: by }, { x: cx, y: cy });
  const medianEnd = extendRay({ x: ax, y: ay }, m, width, height);
  // Tines: from B and C, parallel to the median direction (m - A).
  const dir = { x: m.x - ax, y: m.y - ay };
  const bEnd = extendRay({ x: bx, y: by }, { x: bx + dir.x, y: by + dir.y }, width, height);
  const cEnd = extendRay({ x: cx, y: cy }, { x: cx + dir.x, y: cy + dir.y }, width, height);

  return (
    <g>
      {/* Handle line B-C (the fork base) doubles as the hit area */}
      <line
        x1={bx}
        x2={cx}
        y1={by}
        y2={cy}
        stroke="transparent"
        strokeWidth={10}
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
      {/* Fill between the two tines */}
      <polygon
        points={`${bx},${by} ${bEnd.x},${bEnd.y} ${cEnd.x},${cEnd.y} ${cx},${cy}`}
        fill={`${color}14`}
        style={{ pointerEvents: "none" }}
      />
      <line x1={bx} x2={cx} y1={by} y2={cy} stroke={color} strokeWidth={strokeWidth} style={{ pointerEvents: "none" }} />
      <line x1={ax} x2={medianEnd.x} y1={ay} y2={medianEnd.y} stroke={color} strokeWidth={strokeWidth} style={{ pointerEvents: "none" }} />
      <line x1={bx} x2={bEnd.x} y1={by} y2={bEnd.y} stroke={color} strokeWidth={strokeWidth} opacity={0.8} style={{ pointerEvents: "none" }} />
      <line x1={cx} x2={cEnd.x} y1={cy} y2={cEnd.y} stroke={color} strokeWidth={strokeWidth} opacity={0.8} style={{ pointerEvents: "none" }} />
      {selected && (
        <>
          <DrawHandle x={ax} y={ay} color={color} selected onPointerDown={dragA} />
          <DrawHandle x={bx} y={by} color={color} selected onPointerDown={dragB} />
          <DrawHandle x={cx} y={cy} color={color} selected onPointerDown={dragC} />
        </>
      )}
    </g>
  );
}
