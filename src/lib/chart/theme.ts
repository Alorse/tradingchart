/**
 * Single source of truth for the TradingView palette.
 *
 * The canonical values live in `globals.css` as `--color-tv-*` custom
 * properties (consumed by Tailwind `tv-*` classes). lightweight-charts renders
 * to a canvas and needs real color strings — it cannot consume `var(...)` — so
 * we read those CSS variables at runtime instead of duplicating the hex values.
 *
 * The literal `FALLBACK` documents the expected keys and is returned during SSR
 * (before a `document` exists) and for any variable the stylesheet doesn't
 * define. Keep it in sync with `globals.css` — a stale entry here paints the
 * previous palette for the first frame; if they diverge, CSS wins on the
 * client. The `--color-tv-*` properties now resolve through a `--tv-*`
 * indirection (so a theme class can swap them), which `getComputedStyle` flattens
 * to a real color string for us — nothing here has to know about it.
 */
export interface TvColors {
  bg: string;
  panel: string;
  panelHover: string;
  popup: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  textDisabled: string;
  green: string;
  red: string;
  blue: string;
  blueText: string;
  yellow: string;
  purple: string;
  grid: string;
}

const FALLBACK: TvColors = {
  bg: "#0f0f0f",
  panel: "#171717",
  panelHover: "#2e2e2e",
  popup: "#1f1f1f",
  border: "#2e2e2e",
  borderStrong: "#3d3d3d",
  text: "#dbdbdb",
  textMuted: "#8c8c8c",
  textDim: "#636363",
  textDisabled: "#575757",
  green: "#089981",
  red: "#f23645",
  blue: "#2962ff",
  blueText: "#5b9cf6",
  yellow: "#ff9800",
  purple: "#ab47bc",
  grid: "#2a2a2a",
};

const CSS_VAR: Record<keyof TvColors, string> = {
  bg: "--color-tv-bg",
  panel: "--color-tv-panel",
  panelHover: "--color-tv-panel-hover",
  popup: "--color-tv-popup",
  border: "--color-tv-border",
  borderStrong: "--color-tv-border-strong",
  text: "--color-tv-text",
  textMuted: "--color-tv-text-muted",
  textDim: "--color-tv-text-dim",
  textDisabled: "--color-tv-text-disabled",
  green: "--color-tv-green",
  red: "--color-tv-red",
  blue: "--color-tv-blue",
  blueText: "--color-tv-blue-text",
  yellow: "--color-tv-yellow",
  purple: "--color-tv-purple",
  grid: "--color-tv-grid",
};

/**
 * Read the TV palette from the CSS custom properties (the single source of
 * truth). Falls back to `FALLBACK` on the server or for any missing variable.
 */
export function getTvColors(): TvColors {
  if (typeof document === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const out = {} as TvColors;
  for (const key of Object.keys(CSS_VAR) as (keyof TvColors)[]) {
    const v = cs.getPropertyValue(CSS_VAR[key]).trim();
    out[key] = v || FALLBACK[key];
  }
  return out;
}

/** Font stack used when `--font-sans` can't be read (SSR, or before next/font). */
const FALLBACK_FONT_FAMILY = "Inter, system-ui, sans-serif";

/**
 * Font family for the chart canvas, with `--font-sans` resolved to real family
 * names — for exactly the reason the colors are resolved above, and with a
 * sharper failure mode.
 *
 * lightweight-charts builds the canvas font as `` `${fontSize}px ${fontFamily}` ``
 * and assigns it to `ctx.font`. The canvas 2D font setter parses that as a CSS
 * `font` shorthand with no element to substitute against, so a literal
 * `var(--font-sans)` makes the *whole* declaration syntactically invalid — and
 * an invalid `ctx.font` is **ignored entirely**, leaving the canvas default
 * `10px sans-serif`. The size is part of the same string, so passing `var(...)`
 * here silently discards `layout.fontSize` too: the axis labels stay 10px no
 * matter what size is configured. Resolve it here instead of inlining `var()`.
 */
export function getTvFontFamily(): string {
  if (typeof document === "undefined") return FALLBACK_FONT_FAMILY;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return v ? `${v}, ${FALLBACK_FONT_FAMILY}` : FALLBACK_FONT_FAMILY;
}
