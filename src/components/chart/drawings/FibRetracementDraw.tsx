"use client";

import { useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Drawing, FibRetracementDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { formatPrice } from "@/lib/format";
import { translateDrawing } from "@/lib/drawings/translate";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: FibRetracementDrawing;
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

const LEVEL_COLORS: Record<string, string> = {
  "0": TV_PINE.fibGray,
  "0.236": TV_PINE.red,
  "0.382": TV_PINE.fibOrange,
  "0.5": TV_PINE.green,
  "0.618": TV_PINE.blue,
  "0.786": TV_PINE.fibPurple,
  "1": TV_PINE.fibGray,
};

export function FibRetracementDraw({
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
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<FibRetracementDrawing | null>(null);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "fib-retracement") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragA = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { a: pt } as Partial<FibRetracementDrawing>),
    onEnd: commitEnd,
  });
  const dragB = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { b: pt } as Partial<FibRetracementDrawing>),
    onEnd: commitEnd,
  });
  const dragShape = useDragShape<FibRetracementDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => translateDrawing(orig as Drawing, dt, dp) as Partial<FibRetracementDrawing>,
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "fib-retracement" ? current : null;
    },
    { onStart: snap, onMove: (patch) => updateLive(drawing.id, patch), onEnd: commitEnd },
  );

  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);
  const startPrice = drawing.a.price;
  const endPrice = drawing.b.price;
  const range = endPrice - startPrice;

  return (
    <g>
      {/* Background rectangle (clickable) */}
      <rect
        x={left}
        y={Math.min(ay, by)}
        width={right - left}
        height={Math.abs(by - ay)}
        fill="transparent"
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
      {drawing.levels.map((level) => {
        const price = startPrice + range * level;
        const y = candleSeries?.priceToCoordinate(price) ?? null;
        if (y === null) return null;
        const label = level === 0 ? "0" : level === 1 ? "1" : String(level);
        const color = LEVEL_COLORS[label] ?? TV_PINE.fibGray;
        return (
          <g key={level}>
            <line
              x1={left}
              x2={right}
              y1={y}
              y2={y}
              stroke={color}
              strokeWidth={1}
              strokeDasharray={level === 0 || level === 1 ? undefined : "3,3"}
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
              {`${(level * 100).toFixed(1)}%  ${formatPrice(price)}`}
            </text>
          </g>
        );
      })}
      {selected && (
        <>
          <DrawHandle x={ax} y={ay} color={TV_PINE.blue} selected onMouseDown={dragA} />
          <DrawHandle x={bx} y={by} color={TV_PINE.blue} selected onMouseDown={dragB} />
        </>
      )}
    </g>
  );
}
