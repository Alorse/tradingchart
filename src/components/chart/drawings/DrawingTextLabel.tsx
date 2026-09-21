"use client";

import type { Drawing } from "@/lib/drawings/types";
import {
  boxLabelPlacement,
  lineLabelPlacement,
  resolveTextLabel,
  type LabelPlacement,
  type ResolvedTextLabel,
} from "@/lib/drawings/text-label";

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
 */
export function DrawingTextLabel({
  drawing,
  lineColor,
  geometry,
}: {
  drawing: Drawing;
  /** The drawing's resolved line colour — the text colour's fallback. */
  lineColor: string;
  geometry: LabelGeometry;
}) {
  const label = resolveTextLabel(drawing, lineColor);
  if (!label || !label.showText || !label.text.trim()) return null;

  const lines = label.text.split("\n");
  const p = placeLabel(geometry, label, lines.length);
  // Vertical centre → alphabetic baseline, computed rather than left to
  // `dominant-baseline` (inconsistent on <tspan> across browsers and in the
  // serialized SVG the snapshot composer rasterizes).
  const baselineShift = label.fontSize * 0.35;

  return (
    <text
      x={p.x}
      y={p.y + p.firstLineDy + baselineShift}
      transform={p.angle !== 0 ? `rotate(${p.angle} ${p.x} ${p.y})` : undefined}
      fill={label.textColor}
      fontSize={label.fontSize}
      fontWeight={label.bold ? "bold" : undefined}
      fontStyle={label.italic ? "italic" : undefined}
      textAnchor={p.textAnchor}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={p.x} dy={i === 0 ? 0 : p.lineHeight}>
          {line || " "}
        </tspan>
      ))}
    </text>
  );
}
