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

/**
 * The Pine/trading color set: every hex the chart annotations and studies draw
 * with, in one place.
 *
 * This is deliberately *not* derived from `getTvColors()`, and the two sets
 * deliberately disagree (`TV_PINE.green` is `#26a69a`, `--tv-green` is
 * `#089981`). The `--tv-*` tokens are UI chrome — they retheme with the app,
 * light or dark. These are the TradingView/Pine conventions the trading layer
 * has always drawn with, and the first group below is **persisted**: a
 * drawing's color is written into its `user_drawings` row the moment it is
 * created, so changing one of these values here would not restyle existing
 * drawings, it would only make new ones disagree with old ones. Treat the
 * `PERSISTED` values as frozen; the rest are free to retune.
 *
 * Direction vs. movement is a real distinction here — see the semantic-color
 * rule in CLAUDE.md. `blue` is *long/buy*, `green` is *up/profit*.
 */
export const TV_PINE = {
  // ── PERSISTED: written into stored drawing/order data. Do not change. ──
  /** Limit orders, long/buy direction, rectangle fill. */
  blue: "#2962ff",
  /** Take-profit, and a drawing's target/up rail. */
  green: "#26a69a",
  /** A drawing's stop/down rail. */
  red: "#ef5350",
  /** Stop-loss order lines. */
  amber: "#fbc02d",
  /** Neutral stroke and label color for a new drawing. */
  neutral: "#d1d4dc",

  // ── Overlay chrome: drawn every frame, never stored. ──
  /** Liquidation price line. */
  liquidation: "#ff5252",
  /** Magnet-snap marker on the placement preview. */
  snap: "#ffb74d",
  /** Brush drawn in highlighter mode. */
  highlighter: "#ffeb3b",
  /** Text/strokes that must read on any pill fill. */
  white: "#ffffff",
  /** Fill behind an outlined pill on the chart — darker than any panel. */
  pillFill: "#0a0a0a",
} as const;

/**
 * Study series colors (VuManChu Cipher B). Ported from the Pine source, which
 * is why they don't sit on the `--tv-*` ramp — the study is recognisable by
 * these exact colors. Not persisted, so they can be retuned freely.
 */
export const TV_STUDY = {
  /** WaveTrend 1 area (light blue). */
  wt1: "#90caf9",
  /** WaveTrend 2 area (deeper indigo). */
  wt2: "#5b62e5",
  /** RSI line (vivid purple). */
  rsi: "#e040fb",
  /** Bullish cross dot and bull-divergence arrow. */
  crossUp: "#00e676",
  /** Bearish cross dot. */
  crossDown: "#ff5252",
  /** "B" buy signal. */
  buy: "#3fff00",
  /** "S" sell signal. */
  sell: "#ff0000",
  /** "G" gold-buy signal. */
  gold: "#e2a400",
  /** Bear-divergence arrow. */
  bearDiv: "#e60000",
} as const;
