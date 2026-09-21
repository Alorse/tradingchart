import type { Drawing, DrawingKind, HorzTextAlign, TextLabelFields, VertTextAlign } from "./types";

export interface TextLabelDefaults {
  fontSize: number;
  horzTextAlign: HorzTextAlign;
  vertTextAlign: VertTextAlign;
}

/**
 * TradingView's per-tool defaults for the text label. They genuinely differ
 * between tools (horizontal lines use a smaller font and sit the label above
 * the line; sloped lines sit it below; a rectangle left-aligns; a vertical line
 * pushes it to the top), so renderers and the settings dialog both read them
 * from here instead of hardcoding their own. A kind missing from this map does
 * not support a text label.
 */
export const TEXT_LABEL_DEFAULTS: Partial<Record<DrawingKind, TextLabelDefaults>> = {
  hray: { fontSize: 12, horzTextAlign: "center", vertTextAlign: "top" },
  hline: { fontSize: 12, horzTextAlign: "center", vertTextAlign: "top" },
  trendline: { fontSize: 14, horzTextAlign: "center", vertTextAlign: "bottom" },
  ray: { fontSize: 14, horzTextAlign: "center", vertTextAlign: "bottom" },
  arrow: { fontSize: 14, horzTextAlign: "center", vertTextAlign: "bottom" },
  rectangle: { fontSize: 14, horzTextAlign: "left", vertTextAlign: "bottom" },
  vline: { fontSize: 14, horzTextAlign: "right", vertTextAlign: "top" },
};

/** Whether `kind` carries a user text label (and gets the dialog's Text tab). */
export function supportsTextLabel(kind: DrawingKind): boolean {
  return TEXT_LABEL_DEFAULTS[kind] !== undefined;
}

/** Every text-label field with the kind's defaults filled in. */
export type ResolvedTextLabel = Required<TextLabelFields>;

/**
 * Fills in the unset text-label fields of `d`. The text colour falls back to
 * the line colour (`lineColor`, which the caller already resolved against the
 * renderer's own default), as TradingView does. Returns null for kinds
 * without text support.
 */
export function resolveTextLabel(d: Drawing, lineColor: string): ResolvedTextLabel | null {
  const defaults = TEXT_LABEL_DEFAULTS[d.kind];
  if (!defaults) return null;
  const f = d as TextLabelFields;
  return {
    showText: f.showText ?? false,
    text: f.text ?? "",
    textColor: f.textColor ?? lineColor,
    fontSize: f.fontSize ?? defaults.fontSize,
    bold: f.bold ?? false,
    italic: f.italic ?? false,
    horzTextAlign: f.horzTextAlign ?? defaults.horzTextAlign,
    vertTextAlign: f.vertTextAlign ?? defaults.vertTextAlign,
  };
}

// ── Label geometry ─────────────────────────────────────────────────────────
//
// Pure pixel math for where a label sits, shared by every renderer. The
// convention follows TradingView: `horzTextAlign` slides the label ALONG the
// line (left / centre / right end of its span), `vertTextAlign` puts it
// ACROSS the line (above it, on it, below it). A sloped line rotates the label
// to run along it, always kept upright (reading left→right; a vertical line
// reads bottom→top, so "top" there means the left side of the line).

interface Pt {
  x: number;
  y: number;
}

export interface LabelPlacement {
  /** Anchor point, in chart pixels. The label is rotated `angle` about it. */
  x: number;
  y: number;
  /** Rotation in degrees, in [-90, 90). 0 for a horizontal line or a box. */
  angle: number;
  /** SVG `text-anchor` for the anchor point. */
  textAnchor: "start" | "middle" | "end";
  /** Local-frame (pre-rotation) y offset from the anchor to the vertical
   *  centre of the first line; positive is below the line. */
  firstLineDy: number;
  /** Distance between consecutive lines' centres. */
  lineHeight: number;
}

export interface LineLabelOptions {
  /** Distance from a span end to a start/end-aligned label. */
  pad?: number;
  /** Clearance between the line and an above/below label. */
  gap?: number;
  /** Extra clearance at the span's start (the upright-reading start), for
   *  something already drawn there — the hline/hray price chip. Only applied
   *  to a start-aligned label. */
  startInset?: number;
}

export const LABEL_LINE_HEIGHT = 1.2;

const ANCHOR_BY_HORZ = { left: "start", center: "middle", right: "end" } as const;

/** Local-frame offset of the first line's centre for a block of `lineCount`
 *  lines placed above / on / below a reference line at y=0. */
function blockOffset(vert: VertTextAlign, lineCount: number, lh: number, gap: number): number {
  const n = Math.max(1, lineCount);
  if (vert === "top") return -(gap + lh / 2 + (n - 1) * lh);
  if (vert === "bottom") return gap + lh / 2;
  return -((n - 1) * lh) / 2;
}

/** Label placement for a line segment p1–p2 (the endpoints' order is
 *  irrelevant: the label is always laid out reading upright). */
export function lineLabelPlacement(
  p1: Pt,
  p2: Pt,
  horz: HorzTextAlign,
  vert: VertTextAlign,
  fontSize: number,
  lineCount: number,
  opts: LineLabelOptions = {},
): LabelPlacement {
  const pad = opts.pad ?? 6;
  const gap = opts.gap ?? 4;
  const lh = fontSize * LABEL_LINE_HEIGHT;

  let start = p1;
  let end = p2;
  let angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
  // Keep text upright: flip a leftward (or downward-vertical) direction.
  if (angle >= 90 || angle < -90) {
    [start, end] = [p2, p1];
    angle = angle >= 90 ? angle - 180 : angle + 180;
  }
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = len > 0 ? (end.x - start.x) / len : 1;
  const uy = len > 0 ? (end.y - start.y) / len : 0;
  if (len === 0) angle = 0;

  let x: number;
  let y: number;
  if (horz === "left") {
    const d = pad + (opts.startInset ?? 0);
    x = start.x + ux * d;
    y = start.y + uy * d;
  } else if (horz === "right") {
    x = end.x - ux * pad;
    y = end.y - uy * pad;
  } else {
    x = (start.x + end.x) / 2;
    y = (start.y + end.y) / 2;
  }

  return {
    x,
    y,
    angle: angle === 0 ? 0 : angle, // normalise -0
    textAnchor: ANCHOR_BY_HORZ[horz],
    firstLineDy: blockOffset(vert, lineCount, lh, gap),
    lineHeight: lh,
  };
}

/** Label placement INSIDE a box (the rectangle tool), `pad` px from its
 *  edges. Corners may be given in any order. */
export function boxLabelPlacement(
  a: Pt,
  b: Pt,
  horz: HorzTextAlign,
  vert: VertTextAlign,
  fontSize: number,
  lineCount: number,
  pad = 6,
): LabelPlacement {
  const lh = fontSize * LABEL_LINE_HEIGHT;
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  const x = horz === "left" ? left + pad : horz === "right" ? right - pad : (left + right) / 2;
  // Anchor on the matching edge (or centre) and grow the block inward, so the
  // same "block offset" rule as a line applies with the edge as the line.
  const y = vert === "top" ? top : vert === "bottom" ? bottom : (top + bottom) / 2;
  const inward: VertTextAlign = vert === "top" ? "bottom" : vert === "bottom" ? "top" : "middle";
  return {
    x,
    y,
    angle: 0,
    textAnchor: ANCHOR_BY_HORZ[horz],
    firstLineDy: blockOffset(inward, lineCount, lh, pad),
    lineHeight: lh,
  };
}

/** Approximate local-frame bounds of a placed label (text isn't measured —
 *  same per-character estimate `TextDraw` uses for its hit box). */
export function labelBounds(
  p: LabelPlacement,
  lines: readonly string[],
  fontSize: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(1, ...lines.map((l) => l.length)) * fontSize * 0.62;
  const x = p.textAnchor === "start" ? 0 : p.textAnchor === "middle" ? -width / 2 : -width;
  return {
    x,
    y: p.firstLineDy - p.lineHeight / 2,
    width,
    height: Math.max(1, lines.length) * p.lineHeight,
  };
}
