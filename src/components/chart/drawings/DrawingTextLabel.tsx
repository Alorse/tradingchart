"use client";

import { useRef, useState } from "react";
import type { Drawing } from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import {
  boxLabelPlacement,
  lineLabelPlacement,
  resolveTextLabel,
  labelBounds,
  type LabelPlacement,
  type ResolvedTextLabel,
} from "@/lib/drawings/text-label";
import { InlineTextEditor } from "./InlineTextEditor";

const PLACEHOLDER = "Add text";

interface Pt {
  x: number;
  y: number;
}

/** Where the label is laid out: along a segment, or inside a box. */
export type LabelGeometry =
  | { kind: "line"; p1: Pt; p2: Pt; startInset?: number }
  | { kind: "box"; a: Pt; b: Pt };

function placeLabel(g: LabelGeometry, label: ResolvedTextLabel, lineCount: number): LabelPlacement {
  const { horzTextAlign: h, vertTextAlign: v, fontSize } = label;
  return g.kind === "line"
    ? lineLabelPlacement(g.p1, g.p2, h, v, fontSize, lineCount, { startInset: g.startInset })
    : boxLabelPlacement(g.a, g.b, h, v, fontSize, lineCount);
}

/**
 * The user text label of a line tool (hline, vline, hray, trendline, ray,
 * arrow, rectangle) — one renderer for all seven. Renders nothing unless the
 * label is switched on AND has non-blank text, so an unlabelled drawing's SVG
 * is exactly what it was before labels existed.
 *
 * Double-clicking the label edits it in place (the same `InlineTextEditor`
 * the text tool uses) instead of opening the settings dialog, which is what a
 * double-click on the drawing's line still does. A label switched on but left
 * blank shows a dim "Add text" placeholder while the drawing is selected, as
 * the way in.
 */
export function DrawingTextLabel({
  drawing,
  lineColor,
  geometry,
  selected = false,
  onPointerDown,
}: {
  drawing: Drawing;
  /** The drawing's resolved line colour — the text colour's fallback. */
  lineColor: string;
  geometry: LabelGeometry;
  selected?: boolean;
  /** The drawing's own body press handler (select / drag), so pressing the
   *  label behaves like pressing the line. */
  onPointerDown?: (e: React.PointerEvent<SVGElement>) => void;
}) {
  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<Drawing | null>(null);
  const [editing, setEditing] = useState(false);

  const label = resolveTextLabel(drawing, lineColor);
  if (!label || !label.showText) return null;
  const blank = !label.text.trim();
  // Blank labels only surface (as a placeholder) on the selected drawing.
  if (blank && !selected && !editing) return null;

  const lines = blank ? [PLACEHOLDER] : label.text.split("\n");
  const p = placeLabel(geometry, label, lines.length);
  // Vertical centre → alphabetic baseline, computed rather than left to
  // `dominant-baseline` (inconsistent on <tspan> across browsers and in the
  // serialized SVG the snapshot composer rasterizes).
  const baselineShift = label.fontSize * 0.35;
  const rotate = p.angle !== 0 ? `rotate(${p.angle} ${p.x} ${p.y})` : undefined;

  if (editing) {
    // The editor is never rotated; open it where the first line starts, i.e.
    // the rotated position of the first line's anchor.
    const rad = (p.angle * Math.PI) / 180;
    const dy = p.firstLineDy + baselineShift;
    return (
      <InlineTextEditor
        x={p.x - dy * Math.sin(rad)}
        y={p.y + dy * Math.cos(rad)}
        fontSize={label.fontSize}
        color={label.textColor}
        bold={label.bold}
        italic={label.italic}
        align={p.textAnchor}
        placeholder={PLACEHOLDER}
        initialValue={label.text}
        onFinish={(value) => {
          setEditing(false);
          const text = value.trim();
          const before = snapshotRef.current;
          if (!before || text === label.text) return;
          // One history entry, against the snapshot taken when editing began.
          updateLive(drawing.id, { text } as Partial<Drawing>);
          void commit(drawing.id, before);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const box = labelBounds(p, lines, label.fontSize);
  return (
    <g>
      {/* Hit area for the inline editor (and select/drag, like the line). */}
      <rect
        x={p.x + box.x}
        y={p.y + box.y}
        width={box.width}
        height={box.height}
        transform={rotate}
        fill="transparent"
        className="drawing-hit"
        style={{ pointerEvents: "all", cursor: selected ? "move" : "pointer", touchAction: "none" }}
        onPointerDown={(e) => {
          if (onPointerDown) onPointerDown(e);
          else e.stopPropagation();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          snapshotRef.current =
            useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id) ?? null;
          setEditing(true);
        }}
      />
      <text
        x={p.x}
        y={p.y + p.firstLineDy + baselineShift}
        transform={rotate}
        fill={label.textColor}
        fillOpacity={blank ? 0.5 : undefined}
        fontSize={label.fontSize}
        fontWeight={label.bold ? "bold" : undefined}
        fontStyle={label.italic || blank ? "italic" : undefined}
        textAnchor={p.textAnchor}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={p.x} dy={i === 0 ? 0 : p.lineHeight}>
            {line || " "}
          </tspan>
        ))}
      </text>
    </g>
  );
}
