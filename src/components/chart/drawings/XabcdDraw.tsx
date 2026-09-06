"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Drawing, XabcdDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { harmonicRatios } from "@/lib/drawings/geometry";
import { translateDrawing } from "@/lib/drawings/translate";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: XabcdDrawing;
  pts: { x: number; y: number }[];
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

const LABELS = ["X", "A", "B", "C", "D"];

export function XabcdDraw({
  drawing,
  pts,
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
  const snapshotRef = useRef<XabcdDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "xabcd") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }
  function moveIndex(i: number, pt: Point) {
    const cur = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (cur?.kind !== "xabcd") return;
    const next = [...cur.points];
    next[i] = pt;
    updateLive(drawing.id, { points: next } as Partial<XabcdDrawing>);
  }
  const d0 = useDragPoint(chart, candleSeries, container, { onStart: snap, onMove: (pt: Point) => moveIndex(0, pt), onEnd: commitEnd });
  const d1 = useDragPoint(chart, candleSeries, container, { onStart: snap, onMove: (pt: Point) => moveIndex(1, pt), onEnd: commitEnd });
  const d2 = useDragPoint(chart, candleSeries, container, { onStart: snap, onMove: (pt: Point) => moveIndex(2, pt), onEnd: commitEnd });
  const d3 = useDragPoint(chart, candleSeries, container, { onStart: snap, onMove: (pt: Point) => moveIndex(3, pt), onEnd: commitEnd });
  const d4 = useDragPoint(chart, candleSeries, container, { onStart: snap, onMove: (pt: Point) => moveIndex(4, pt), onEnd: commitEnd });
  const drags = [d0, d1, d2, d3, d4];
  const dragShape = useDragShape<XabcdDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => translateDrawing(orig as Drawing, dt, dp) as Partial<XabcdDrawing>,
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "xabcd" ? current : null;
    },
    { onStart: snap, onMove: (patch) => updateLive(drawing.id, patch), onEnd: commitEnd },
  );

  if (pts.length < 5) return null;
  const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const r = harmonicRatios(drawing.points.map((p) => p.price));
  // Ratio labels sit at the elbow points B(2), C(3), D(4).
  const ratioLabels: { i: number; text: string }[] = [
    { i: 2, text: Number.isFinite(r.abXa) ? r.abXa.toFixed(3) : "" },
    { i: 3, text: Number.isFinite(r.bcAb) ? r.bcAb.toFixed(3) : "" },
    { i: 4, text: Number.isFinite(r.cdBc) ? r.cdBc.toFixed(3) : "" },
  ];

  return (
    <g>
      <polyline
        points={pointsStr}
        fill={`${color}12`}
        stroke={color}
        strokeWidth={strokeWidth}
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
      {pts.map((p, i) => (
        <g key={i}>
          <text x={p.x + 5} y={p.y - 5} fill={color} fontSize={11} fontWeight="bold" style={{ pointerEvents: "none" }}>
            {LABELS[i]}
          </text>
          {ratioLabels.find((l) => l.i === i)?.text && (
            <text x={p.x + 5} y={p.y + 12} fill="var(--color-tv-text-muted)" fontSize={11} fontFamily="var(--font-mono), monospace" style={{ pointerEvents: "none" }}>
              {ratioLabels.find((l) => l.i === i)!.text}
            </text>
          )}
        </g>
      ))}
      {selected && pts.map((p, i) => (
        <DrawHandle key={`h${i}`} x={p.x} y={p.y} color={color} selected onPointerDown={drags[i]} />
      ))}
    </g>
  );
}
