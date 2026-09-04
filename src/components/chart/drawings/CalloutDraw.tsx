"use client";

import { useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { CalloutDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragPoint } from "./use-drag-point";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: CalloutDrawing;
  anchorX: number;
  anchorY: number;
  targetX: number;
  targetY: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function CalloutDraw({
  drawing,
  anchorX,
  anchorY,
  targetX,
  targetY,
  selected,
  onSelect,
  chart,
  candleSeries,
  container,
}: Props) {
  const color = drawing.color ?? TV_PINE.blue;
  const fontSize = drawing.fontSize ?? 13;
  const { updateLive, commit, remove } = useDrawings();
  const snapshotRef = useRef<CalloutDrawing | null>(null);
  const [editing, setEditing] = useState(drawing.text === "");

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "callout") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragAnchor = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { anchor: pt } as Partial<CalloutDrawing>),
    onEnd: commitEnd,
  });
  const dragTarget = useDragPoint(chart, candleSeries, container, {
    onStart: snap,
    onMove: (pt: Point) => updateLive(drawing.id, { target: pt } as Partial<CalloutDrawing>),
    onEnd: commitEnd,
  });

  function finishEdit(value: string) {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed === "") {
      void remove(drawing.id);
      return;
    }
    if (snapshotRef.current) void commit(drawing.id, { ...snapshotRef.current, text: trimmed });
    else void updateLive(drawing.id, { text: trimmed } as Partial<CalloutDrawing>);
  }

  const lines = drawing.text.split("\n");
  const boxW = Math.max(48, ...lines.map((l) => l.length)) * fontSize * 0.6 + 12;
  const boxH = lines.length * fontSize * 1.25 + 8;
  // Box is centered on the target point.
  const bx = targetX - boxW / 2;
  const by = targetY - boxH / 2;

  return (
    <g>
      {/* Pointer line from the box to the anchor */}
      <line
        x1={targetX}
        y1={targetY}
        x2={anchorX}
        y2={anchorY}
        stroke={color}
        strokeWidth={drawing.lineWidth ?? 1.5}
        style={{ pointerEvents: "none" }}
      />
      <circle cx={anchorX} cy={anchorY} r={3} fill={color} style={{ pointerEvents: "none" }} />

      {editing ? (
        <foreignObject x={bx} y={by} width={Math.max(boxW, 160)} height={Math.max(boxH, 40)} style={{ overflow: "visible" }}>
          <textarea
            autoFocus
            defaultValue={drawing.text}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => finishEdit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget as HTMLTextAreaElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                finishEdit(drawing.text);
              }
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="resize-none rounded border bg-tv-panel px-1.5 py-1 outline-none"
            style={{ pointerEvents: "auto", color, borderColor: color, fontSize, width: Math.max(boxW, 150), minHeight: boxH }}
          />
        </foreignObject>
      ) : (
        <>
          <rect
            x={bx}
            y={by}
            width={boxW}
            height={boxH}
            rx={3}
            fill="var(--color-tv-panel)"
            stroke={color}
            strokeWidth={selected ? 1.5 : 1}
            className="drawing-hit"
            style={{ pointerEvents: "all", cursor: selected ? "move" : "pointer" }}
            onMouseDown={(e) => {
              if (selected) {
                dragTarget(e);
              } else {
                e.stopPropagation();
                onSelect();
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              snap();
              setEditing(true);
            }}
          />
          <text x={targetX} y={by + fontSize + 2} fill={color} fontSize={fontSize} textAnchor="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
            {lines.map((line, i) => (
              <tspan key={i} x={targetX} dy={i === 0 ? 0 : fontSize * 1.25}>
                {line || " "}
              </tspan>
            ))}
          </text>
        </>
      )}

      {selected && !editing && (
        <>
          <DrawHandle x={anchorX} y={anchorY} color={color} selected onMouseDown={dragAnchor} />
          <DrawHandle x={targetX} y={targetY} color={color} selected onMouseDown={dragTarget} />
        </>
      )}
    </g>
  );
}
