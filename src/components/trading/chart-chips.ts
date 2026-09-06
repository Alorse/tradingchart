import type { ReactNode } from "react";
import { TV_PINE } from "@/lib/chart/theme";

/**
 * Geometry and event helpers shared by the SVG chip toolbars both chart order
 * layers draw on an entry line — `OrderLinesLayer` (live account) and
 * `PaperOrderLinesLayer` (simulated). The two toolbars declare different
 * chips, but they lay them out identically: fixed-height pills packed
 * right-to-left from a gap short of the price scale, with the entry line
 * running from x=0 to wherever the leftmost chip starts.
 *
 * Keeping the geometry — and the order-line palette below — in one place is
 * what stops the live and paper toolbars drifting apart, which is the entire
 * point of the paper layer looking like the live one.
 */

/**
 * Bybit-style order-line colours, from the frozen `TV_PINE` trading set (see
 * CLAUDE.md "Color"): a resting limit is always blue regardless of side.
 */
export const LIMIT_COLOR = TV_PINE.blue;
export const TP_COLOR = TV_PINE.green;
export const SL_COLOR = TV_PINE.amber;
export const LIQ_COLOR = TV_PINE.liquidation;

/**
 * Entry/limit line colour by direction. Blue for long/buy, red for
 * short/sell — the *direction* axis, not the up/down movement one.
 */
export function entryLineColor(long: boolean): string {
  return long ? LIMIT_COLOR : LIQ_COLOR;
}

/** Gap kept between the labels/toolbar and the price scale on the right. */
export const AXIS_GAP = 48;

/** Chip height. Both toolbars size their `rect`s off this. */
export const CHIP_HEIGHT = 20;

/** Gap left between two adjacent chips — only `layoutChipsRightToLeft` needs
 *  it, so it stays private to keep the spacing decision in one place. */
const CHIP_GAP = 4;

/** Swallow a click/mousedown so it never reaches the chart's pan handler. */
export function stopEvt(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

/** Width a chip needs to hold `s` — proportional to the glyph count, with a
 *  floor so a one-glyph chip is still a square-ish button. */
export const chipWidth = (s: string) => Math.max(s.length * 7 + 12, 24);

/** A chip that knows its own width and how to draw itself at a given x. */
export interface Chip {
  w: number;
  el: (x: number) => ReactNode;
}

/**
 * Places `chips` right→left starting `AXIS_GAP` short of `width`, and reports
 * where the leftmost one ends up so the caller can stop its entry line there
 * rather than running it under the toolbar.
 */
export function layoutChipsRightToLeft(
  chips: Chip[],
  width: number,
): { placed: ReactNode[]; lineEnd: number } {
  let x = width - AXIS_GAP;
  const placed: ReactNode[] = [];
  for (const c of chips) {
    x -= c.w;
    placed.push(c.el(x));
    x -= CHIP_GAP;
  }
  return { placed, lineEnd: Math.max(0, x) };
}
