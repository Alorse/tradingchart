/**
 * DMI Trade Zone [Alorse] — Pine-faithful transcription of
 *
 *   [diplus, diminus, adx] = ta.dmi(len, lensig)
 *   cond  = diplus > diminus
 *   colo  = cond ? color.green : color.red
 *   plot(adx, 'Shadow', white 50%, linewidth 3)
 *   plot(adx, 'ADX', colo, linewidth 2)
 *   hline(keyLevel)
 *   bgcolor(cond ? color.new(color.silver, 92) : na)
 *
 * The DMI maths itself is `ta.dmi`, which `adx()` in [adx.ts](./adx.ts)
 * already transcribes (RMA-smoothed TR/+DM/-DM, dx = 100·|+DI − −DI| / (+DI +
 * −DI)), so this module only adds what the Pine layers on top: the per-bar
 * `cond` flag that colours the ADX line, and the contiguous spans that flag
 * folds into for the `bgcolor` zone.
 *
 * The Pine's two optional directional plots (its `pl` input) are deliberately
 * not ported: the ADX indicator already draws that pair, so carrying them here
 * too would only let the same two lines appear on a chart twice. `plusDI` and
 * `minusDI` stay on every point regardless — their cross is what `bullish` is.
 *
 * On Pine's `sum == 0 ? 1 : sum` guard: `+DI` and `−DI` are both RMAs of
 * non-negative series, so `sum == 0` implies `+DI == −DI == 0`, hence
 * `|+DI − −DI| == 0` and the bar's dx is 0 either way. `adx()`'s own
 * `if (sum > 0)` branch leaves dx NaN there and feeds the RMA a 0 for it —
 * the same number. The guard is a division-by-zero shield, not a different
 * result.
 */

import type { Candle } from "@/lib/binance/types";
import { adx, type ADXConfig, type ADXPoint } from "./adx";

/** Pine `len` (DI Length) and `lensig` (ADX Smoothing) — `ta.dmi`'s own pair. */
export type DmiTradeZoneConfig = ADXConfig;

export type DmiTradeZonePoint = ADXPoint & {
  /** Pine's `cond = diplus > diminus`: colours the ADX line and fills the zone. */
  bullish: boolean;
};

/** A contiguous run of `bullish` bars, as the inclusive time range it spans. */
export interface DmiZoneSpan {
  /** Time of the first bar in the run. */
  from: number;
  /** Time of the last bar in the run. */
  to: number;
}

export function dmiTradeZone(
  candles: Candle[],
  cfg: DmiTradeZoneConfig = {},
): DmiTradeZonePoint[] {
  // `adx()` already defaults both lengths to 14, which is Pine's default too.
  return adx(candles, cfg).map((p) => ({ ...p, bullish: p.plusDI > p.minusDI }));
}

/**
 * Folds the per-bar `bullish` flags into the runs Pine's `bgcolor` shades.
 *
 * One rect per run rather than one per bar: adjacent translucent rects that
 * share an edge seam visibly where their alpha compounds along the joint, and
 * a long trend is one run, not four hundred nodes.
 */
export function dmiZoneSpans(pts: DmiTradeZonePoint[]): DmiZoneSpan[] {
  const spans: DmiZoneSpan[] = [];
  let open: DmiZoneSpan | null = null;
  for (const p of pts) {
    if (p.bullish) {
      if (open) open.to = p.time;
      else open = { from: p.time, to: p.time };
    } else if (open) {
      spans.push(open);
      open = null;
    }
  }
  if (open) spans.push(open);
  return spans;
}
