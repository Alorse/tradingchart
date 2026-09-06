import type { Drawing } from "./types";

/**
 * What counts as "style" — the fields that describe how a drawing *looks*,
 * never where it sits. Two call sites need this and used to each carry their
 * own hand-maintained copy (`styleOf`'s list in `FloatingContextToolbar`, and
 * an 18-line `if (patch.x !== undefined)` chain in `DrawingSettingsDialog`),
 * which had already drifted apart. They live together here so the divergence
 * is at least visible in one place.
 *
 * The two lists are deliberately *not* merged: they answer different
 * questions, and unifying them would change what each call site persists.
 *
 * - `TEMPLATE_STYLE_FIELDS` — copied off a whole drawing to seed a template
 *   or a tool default. Fib `levels` count as style here: carrying a
 *   customised ladder to the next fib is the point of saving it.
 * - `SETTINGS_STYLE_FIELDS` — picked out of the settings dialog's patch, so
 *   editing a drawing also updates the tool default for the next one.
 */
export const TEMPLATE_STYLE_FIELDS = [
  "color",
  "lineWidth",
  "lineStyle",
  "stopColor",
  "targetColor",
  "textColor",
  "showLabels",
  "fillColor",
  "fillOpacity",
  "fontSize",
  "levels",
] as const;

export const SETTINGS_STYLE_FIELDS = [
  "color",
  "lineWidth",
  "lineStyle",
  // Position-specific
  "stopColor",
  "targetColor",
  "textColor",
  "textSize",
  "showLabels",
  "stopLineWidth",
  "stopLineStyle",
  "targetLineWidth",
  "targetLineStyle",
  "priceLabels",
  "alwaysShowStats",
  "compactStats",
  "statsOverrides",
  // Rectangle-specific
  "fillColor",
  "fillOpacity",
] as const;

/** Copies whichever of `fields` are set on `source`, dropping the rest. */
export function pickStyle(
  source: Partial<Drawing>,
  fields: readonly string[],
): Record<string, unknown> {
  const src = source as unknown as Record<string, unknown>;
  const style: Record<string, unknown> = {};
  for (const f of fields) {
    if (src[f] !== undefined) style[f] = src[f];
  }
  return style;
}

/** The whole style of an existing drawing, for templates and tool defaults. */
export function styleOf(d: Drawing): Record<string, unknown> {
  return pickStyle(d, TEMPLATE_STYLE_FIELDS);
}
