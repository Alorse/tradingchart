import type { DrawingKind, HorzTextAlign, VertTextAlign } from "./types";

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
