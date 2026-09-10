/**
 * "Fit chart to data" / default-view density math.
 *
 * lightweight-charts' own `timeScale().fitContent()` crams every loaded bar
 * into the pane, which reads as unreadably compressed once the candle array
 * holds a full history load (see `fetchCandles(..., 1000)`). Real TradingView
 * never does that: it keeps a fixed ~6px-per-bar density and only loads about
 * one screenful of bars in the first place. We still load 1000 bars (indicators
 * and bar replay need them), so matching the density — not the bar count — is
 * what makes "fit" and the default view look like TradingView's.
 */

/** TradingView's own default time-scale density, in pixels per bar. */
export const TV_DEFAULT_BAR_SPACING = 6;

export interface FitViewParams {
  /** Number of bars currently loaded (candle array length). */
  barCount: number;
  /** Live chart-area width in px — `timeScale().width()`, not the container
   *  (which also includes the price scale). */
  chartAreaWidth: number;
  /** Logical slots the last bar sits from the right edge — the app's existing
   *  right-offset convention, preserved as-is. */
  rightOffset: number;
  /** Target pixels per bar. Defaults to TradingView's own density. */
  barSpacing?: number;
}

export interface LogicalRange {
  from: number;
  to: number;
}

/**
 * Computes the visible logical range for a fit/reset view: as many bars as
 * fit the pane at `barSpacing` px/bar, capped at what's actually loaded — so
 * a 1000-bar dataset still only fills the pane at TradingView's density
 * instead of squeezing all 1000 bars in.
 *
 * Returns null on degenerate input (non-positive width/barCount/barSpacing,
 * or a pane too narrow to fit even one bar) so the caller can fall back to
 * `fitContent()` or a no-op instead of applying a broken zero-span range.
 */
export function fitViewLogicalRange({
  barCount,
  chartAreaWidth,
  rightOffset,
  barSpacing = TV_DEFAULT_BAR_SPACING,
}: FitViewParams): LogicalRange | null {
  if (barCount <= 0 || chartAreaWidth <= 0 || barSpacing <= 0) return null;

  const barsPerScreen = Math.floor(chartAreaWidth / barSpacing);
  const span = Math.min(barCount, barsPerScreen);
  if (span <= 0) return null;

  const lastIndex = barCount - 1;
  const to = lastIndex + rightOffset;
  return { from: to - span, to };
}
