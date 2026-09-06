"use client";

import { useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { TextDrawing, Point } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  drawing: TextDrawing;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

export function TextDraw({
  drawing,
  x,
  y,
  selected,
  onSelect,
  chart,
  candleSeries,
  container,
}: Props) {
  const color = drawing.color ?? TV_PINE.text;
  const fontSize = drawing.fontSize ?? 14;
  const { updateLive, commit, remove } = useDrawings();
  const snapshotRef = useRef<TextDrawing | null>(null);
  // Freshly placed text starts empty → open the editor immediately.
  const [editing, setEditing] = useState(drawing.text === "");

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && current.kind === "text") snapshotRef.current = current;
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  const dragText = useDragShape<TextDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => ({
      anchor: { time: orig.anchor.time + dt, price: orig.anchor.price + dp } as Point,
    }),
    () => {
      const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return current && current.kind === "text" ? (current as TextDrawing) : null;
    },
    {
      onStart: snap,
      onMove: (patch) => updateLive(drawing.id, patch as Partial<TextDrawing>),
      onEnd: commitEnd,
    },
  );

  function startEdit() {
    snap();
    setEditing(true);
  }
  function finishEdit(value: string) {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed === "") {
      // Discard an empty label (matches TradingView's place-then-cancel).
      void remove(drawing.id);
      return;
    }
    // Persist as one history entry (snapshot taken when editing began).
    if (snapshotRef.current) void commit(drawing.id, { ...snapshotRef.current, text: trimmed });
    else void updateLive(drawing.id, { text: trimmed } as Partial<TextDrawing>);
  }

  if (editing) {
    return (
      <foreignObject x={x} y={y - fontSize} width={220} height={90} style={{ overflow: "visible" }}>
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
          className="resize-none rounded border border-tv-blue bg-tv-panel px-1 py-0.5 outline-none"
          style={{
            pointerEvents: "auto",
            color,
            fontSize,
            width: 210,
            minHeight: fontSize + 8,
            lineHeight: 1.2,
          }}
        />
      </foreignObject>
    );
  }

  // Multi-line support: render each line as a tspan.
  const lines = drawing.text.split("\n");
  return (
    <g>
      {/* Transparent hit box for select/drag (approximate bounds). */}
      <rect
        x={x - 2}
        y={y - fontSize}
        width={Math.max(20, ...lines.map((l) => l.length)) * fontSize * 0.62}
        height={lines.length * fontSize * 1.2 + 4}
        fill="transparent"
        className="drawing-hit"
        style={{ pointerEvents: "all", cursor: selected ? "move" : "pointer", touchAction: "none" }}
        onPointerDown={(e) => {
          if (selected) {
            dragText(e);
          } else {
            e.stopPropagation();
            onSelect();
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEdit();
        }}
      />
      <text
        x={x}
        y={y}
        fill={color}
        fontSize={fontSize}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 0 : fontSize * 1.2}>
            {line || " "}
          </tspan>
        ))}
      </text>
      {selected && (
        <rect
          x={x - 3}
          y={y - fontSize - 1}
          width={Math.max(20, ...lines.map((l) => l.length)) * fontSize * 0.62 + 2}
          height={lines.length * fontSize * 1.2 + 6}
          fill="none"
          stroke={TV_PINE.blue}
          strokeWidth={1}
          strokeDasharray="3 3"
          style={{ pointerEvents: "none" }}
        />
      )}
    </g>
  );
}
