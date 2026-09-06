"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Drawing, DateRangeDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { translateDrawing } from "@/lib/drawings/translate";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: DateRangeDrawing;
  xA: number;
  xB: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function DateRangeDraw({
  drawing,
  xA,
  xB,
  height,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<DateRangeDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "date-range") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { timeA: pt.time } as Partial<DateRangeDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { timeB: pt.time } as Partial<DateRangeDrawing>),
    onEnd: commitEnd,
  });
  const dragShape = useDragShape<DateRangeDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => translateDrawing(orig as Drawing, dt, dp) as Partial<DateRangeDrawing>,
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "date-range" ? current : null;
    },
    { onStart: snap, onMove: (patch) => updateLive(drawing.id, patch), onEnd: commitEnd },
  );

  const color = TV_PINE.blue;
  const fill = `${color}14`;
  const stroke = color;
  const left = Math.min(xA, xB);
  const right = Math.max(xA, xB);
  const diffSec = Math.abs(drawing.timeB - drawing.timeA);
  const label = formatDuration(diffSec);

  return (
    <g>
      <rect
        x={left}
        y={0}
        width={right - left}
        height={height}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray="4,3"
        className="drawing-hit"
        style={{ pointerEvents: "all", cursor: selected ? "move" : "pointer", touchAction: "none" }}
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
      <text
        x={(left + right) / 2}
        y={20}
        textAnchor="middle"
        fill={color}
        fontSize={11}
        fontFamily="var(--font-mono), monospace"
        style={{ pointerEvents: "none" }}
      >
        {label}
      </text>
      {selected && (
        <>
          <DrawHandle x={xA} y={height / 2} color={color} selected onPointerDown={dragA} />
          <DrawHandle x={xB} y={height / 2} color={color} selected onPointerDown={dragB} />
        </>
      )}
    </g>
  );
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
