"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { HLineDrawing } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { formatPrice } from "@/lib/format";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: HLineDrawing;
  y: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function HLineDraw({
  drawing,
  y,
  width,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const color = drawing.color ?? TV_PINE.blue;
  const stroke = color;
  const strokeWidth = drawing.lineWidth ?? 1;
  const strokeDasharray = drawing.lineStyle === 1 ? "6 4" : drawing.lineStyle === 2 ? "2 4" : "none";
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<HLineDrawing | null>(null);

  function snap() {
    const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (c && c.kind === "hline") snapshotRef.current = c;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragLine = useDragShape<HLineDrawing>(
    chart,
    candleSeries,
    container,
    (orig, _dt, dp) => ({ price: orig.price + dp }),
    () => {
      const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return c && c.kind === "hline" ? (c as HLineDrawing) : null;
    },
    {
      onStart: snap,
      onMove: (patch) => updateLive(drawing.id, patch as Partial<HLineDrawing>),
      onEnd: commitEnd,
    },
  );

  return (
    <g>
      {/* Hit area (invisible, easier to click) */}
      <line
        x1={0}
        x2={width}
        y1={y}
        y2={y}
        stroke="transparent"
        strokeWidth={10}
        className="drawing-hit"
        style={{
          pointerEvents: "stroke",
          cursor: selected ? "ns-resize" : "pointer",
        }}
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
      {/* Visible line */}
      <line
        x1={0}
        x2={width}
        y1={y}
        y2={y}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        style={{ pointerEvents: "none" }}
      />
      {/* Price label */}
      <g style={{ pointerEvents: "none" }}>
        <rect
          x={4}
          y={y - 9}
          width={drawing.alert?.enabled ? 94 : 78}
          height={18}
          fill={color}
          rx={2}
        />
        <text
          x={8}
          y={y + 4}
          fill={TV_PINE.white}
          fontSize={11}
          fontFamily="var(--font-mono), monospace"
        >
          {formatPrice(drawing.price)}
        </text>
        {drawing.alert?.enabled && (
          <text x={84} y={y + 4} fill={TV_PINE.white} fontSize={11}>
            🔔
          </text>
        )}
      </g>
    </g>
  );
}
