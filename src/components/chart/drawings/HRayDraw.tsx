"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { HRayDrawing } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { formatPrice } from "@/lib/format";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: HRayDrawing;
  /** Pixel x of the anchor */
  anchorX: number;
  /** Pixel y of the price */
  y: number;
  /** Container width — ray extends to this */
  width: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function HRayDraw({
  drawing,
  anchorX,
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
  const strokeDasharray = drawing.lineStyle === 1 ? "6 4" : drawing.lineStyle === 2 ? "2 4" : undefined;
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<HRayDrawing | null>(null);

  function snap() {
    const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (c && c.kind === "hray") snapshotRef.current = c;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragLine = useDragShape<HRayDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => ({
      anchor: { time: orig.anchor.time + dt, price: orig.anchor.price + dp },
    }),
    () => {
      const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return c && c.kind === "hray" ? (c as HRayDrawing) : null;
    },
    {
      onStart: snap,
      onMove: (patch) => updateLive(drawing.id, patch as Partial<HRayDrawing>),
      onEnd: commitEnd,
    },
  );

  return (
    <g>
      <line
        x1={anchorX}
        x2={width}
        y1={y}
        y2={y}
        stroke="transparent"
        strokeWidth={10}
        className="drawing-hit"
        style={{
          pointerEvents: "stroke",
          cursor: selected ? "move" : "pointer",
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
      <line
        x1={anchorX}
        x2={width}
        y1={y}
        y2={y}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        style={{ pointerEvents: "none" }}
      />
      {/* Anchor handle */}
      <circle
        cx={anchorX}
        cy={y}
        r={4}
        fill={color}
        stroke={TV_PINE.white}
        strokeWidth={1}
        style={{ pointerEvents: "none" }}
      />
      {/* Price label */}
      <g style={{ pointerEvents: "none" }}>
        <rect
          x={anchorX + 8}
          y={y - 9}
          width={drawing.alert?.enabled ? 94 : 78}
          height={18}
          fill={color}
          rx={2}
        />
        <text
          x={anchorX + 12}
          y={y + 4}
          fill={TV_PINE.white}
          fontSize={11}
          fontFamily="var(--font-mono), monospace"
        >
          {formatPrice(drawing.anchor.price)}
        </text>
        {drawing.alert?.enabled && (
          <text x={anchorX + 88} y={y + 4} fill={TV_PINE.white} fontSize={11}>
            🔔
          </text>
        )}
      </g>
    </g>
  );
}
