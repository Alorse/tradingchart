"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Drawing, PriceRangeDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { formatPrice } from "@/lib/format";
import { translateDrawing } from "@/lib/drawings/translate";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: PriceRangeDrawing;
  xA: number;
  xB: number;
  yA: number;
  yB: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function PriceRangeDraw({
  drawing,
  xA,
  xB,
  yA,
  yB,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<PriceRangeDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "price-range") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) =>
      updateLive(drawing.id, { priceA: pt.price, timeA: pt.time } as Partial<PriceRangeDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) =>
      updateLive(drawing.id, { priceB: pt.price, timeB: pt.time } as Partial<PriceRangeDrawing>),
    onEnd: commitEnd,
  });
  const dragShape = useDragShape<PriceRangeDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => translateDrawing(orig as Drawing, dt, dp) as Partial<PriceRangeDrawing>,
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "price-range" ? current : null;
    },
    { onStart: snap, onMove: (patch) => updateLive(drawing.id, patch), onEnd: commitEnd },
  );

  const isUp = drawing.priceB >= drawing.priceA;
  const baseColor = isUp ? TV_PINE.green : TV_PINE.red;
  const fill = `${baseColor}1a`;
  const stroke = baseColor;

  const left = Math.min(xA, xB);
  const right = Math.max(xA, xB);
  const top = Math.min(yA, yB);
  const bottom = Math.max(yA, yB);
  const diff = drawing.priceB - drawing.priceA;
  const pct = drawing.priceA === 0 ? 0 : (diff / drawing.priceA) * 100;
  const sign = diff >= 0 ? "+" : "";

  return (
    <g>
      <rect
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fill={fill}
        stroke={stroke}
        strokeWidth={drawing.lineWidth ?? 1}
        strokeDasharray={drawing.lineStyle === 1 ? "6 4" : drawing.lineStyle === 2 ? "2 4" : undefined}
        className="drawing-hit"
        style={{ pointerEvents: "all", cursor: selected ? "move" : "pointer" }}
        onMouseDown={(e) => {
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
        y={Math.max(top - 6, 12)}
        textAnchor="middle"
        fill={baseColor}
        fontSize={11}
        fontFamily="var(--font-mono), monospace"
        style={{ pointerEvents: "none" }}
      >
        {`${sign}${formatPrice(diff)} (${sign}${pct.toFixed(2)}%)`}
      </text>
      {selected && (
        <>
          <DrawHandle x={xA} y={yA} color={baseColor} selected onMouseDown={dragA} />
          <DrawHandle x={xB} y={yB} color={baseColor} selected onMouseDown={dragB} />
        </>
      )}
    </g>
  );
}
