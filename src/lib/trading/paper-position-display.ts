import { unrealizedPnl, positionRoi } from "@/lib/trading/paper-engine";
import type { PaperPosition } from "@/lib/trading/paper-engine";

/**
 * How a position's floating P&L is displayed, independent of ROE% (which is
 * always shown alongside it — see CLAUDE.md's "true ROI" note). Persisted as
 * a user preference in `paper-trading-store.ts`, not here: this module stays
 * pure so the money math is unit-testable without the store.
 */
export type PnlDisplayMode = "MONEY" | "TICKS" | "PERCENT";

export const PNL_DISPLAY_MODES: PnlDisplayMode[] = ["MONEY", "TICKS", "PERCENT"];

/**
 * The floating P&L in whichever unit `mode` asks for. Signed by direction in
 * every mode — a short profits from a falling mark, so `TICKS`/`PERCENT` flip
 * the raw `mark - entry` delta the same way `unrealizedPnl` already does for
 * `MONEY` (via `pnlAtExit`).
 */
export function pnlDisplayValue(
  position: PaperPosition,
  mark: number,
  mode: PnlDisplayMode,
  tickSize: number,
): number {
  const sign = position.side === "LONG" ? 1 : -1;
  switch (mode) {
    case "MONEY":
      return unrealizedPnl(position, mark);
    case "TICKS":
      return tickSize > 0 ? ((mark - position.entryPrice) / tickSize) * sign : 0;
    case "PERCENT":
      return position.entryPrice > 0
        ? ((mark - position.entryPrice) / position.entryPrice) * 100 * sign
        : 0;
  }
}

/** Human suffix for a `pnlDisplayValue` reading, e.g. "+12.50 USDT" / "+3 ticks" / "+1.25%". */
export function formatPnlDisplay(value: number, mode: PnlDisplayMode): string {
  const sign = value >= 0 ? "+" : "";
  switch (mode) {
    case "MONEY":
      return `${sign}${value.toFixed(2)} USDT`;
    case "TICKS":
      return `${sign}${value.toFixed(0)} ticks`;
    case "PERCENT":
      return `${sign}${value.toFixed(2)}%`;
  }
}

/**
 * True once the mark has closed to within 10% of the entry-to-liquidation
 * distance — the point TradingView starts calling out liquidation risk on a
 * position row. Zero distance (a position with no real liquidation price, or
 * one sitting exactly at entry — already-liquidated in practice) never reads
 * as urgent, since there is no meaningful "distance" to close in on.
 */
export function isLiquidationUrgent(position: PaperPosition, mark: number): boolean {
  if (position.liquidationPrice <= 0) return false;
  const fullDistance = Math.abs(position.entryPrice - position.liquidationPrice);
  if (fullDistance <= 0) return false;
  const remaining = Math.abs(mark - position.liquidationPrice);
  return remaining < fullDistance * 0.1;
}

/** Everything a position row needs to render, computed once per (position, mark, mode). */
export interface PaperPositionFigures {
  mark: number;
  pnl: number;
  displayPnl: number;
  roe: number;
  displaySymbol: string;
  liquidationUrgent: boolean;
}

/**
 * As `computePositionFigures`, for a caller that already holds this symbol's
 * mark. `undefined` means the symbol hasn't ticked yet and falls back to the
 * entry price — a position that has never ticked is worth what it cost — so
 * that rule stays here rather than at each call site.
 *
 * Exists so a consumer of a *single* position (the chart's order-line layer)
 * can subscribe to just its own mark instead of the whole `marks` map, which
 * gets a new identity whenever any other symbol ticks.
 */
export function positionFiguresAt(
  position: PaperPosition,
  mark: number | undefined,
  mode: PnlDisplayMode,
  tickSize: number,
): PaperPositionFigures {
  const at = mark ?? position.entryPrice;
  return {
    mark: at,
    pnl: unrealizedPnl(position, at),
    displayPnl: pnlDisplayValue(position, at, mode, tickSize),
    roe: positionRoi(position, at) * 100,
    displaySymbol: position.feedSymbol ?? position.symbol,
    liquidationUrgent: isLiquidationUrgent(position, at),
  };
}

export function computePositionFigures(
  position: PaperPosition,
  marks: Record<string, number>,
  mode: PnlDisplayMode,
  tickSize: number,
): PaperPositionFigures {
  return positionFiguresAt(position, marks[position.symbol], mode, tickSize);
}
