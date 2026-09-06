"use client";

import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { useMemo } from "react";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import type { LongPositionDrawing, ShortPositionDrawing } from "@/lib/drawings/types";
import { formatPrice } from "@/lib/format";
import { TV_PINE } from "@/lib/chart/theme";

const CHIP_H = 16;
/** Below this the price axis is too narrow to fit a readable price. */
const MIN_AXIS_W = 24;

interface Props {
  symbol: string;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  containerWidth: number;
  mainPaneHeight: number;
  /** Bumped by PriceChart on every chart repaint, so chips follow pans/zooms. */
  renderTick: number;
}

/**
 * Small price-axis flags for a long/short position's entry/stop/target,
 * opt-in per drawing via `priceLabels`. Lives outside `DrawingsLayer` on
 * purpose: that layer's SVG is clipped to the plot area (`chartAreaWidth`)
 * so its price lines can be clipped at the pane boundary, but a price-axis
 * flag has to render *past* that boundary, on the native axis strip —
 * the same reason `BarCountdown` is its own absolutely-positioned overlay
 * instead of living inside the drawings SVG.
 */
export function PositionPriceLabels({
  symbol,
  chart,
  candleSeries,
  containerWidth,
  mainPaneHeight,
  renderTick,
}: Props) {
  void renderTick;
  const drawings = useDrawingsStore((s) => s.drawings);

  // The filter only changes when the store does, but this component
  // re-renders on every chart repaint (`renderTick`), so keep the whole-store
  // scan out of the pan/zoom path. The type predicate is what narrows `d` for
  // the loop below — a plain `.filter()` leaves it as the full union.
  const positions = useMemo(
    () =>
      drawings.filter(
        (d): d is LongPositionDrawing | ShortPositionDrawing =>
          d.symbol === symbol &&
          !d.hidden &&
          (d.kind === "long" || d.kind === "short") &&
          d.priceLabels === true,
      ),
    [drawings, symbol],
  );

  if (!chart || !candleSeries) return null;
  const plotW = chart.timeScale().width();
  const axisW = containerWidth - plotW;
  if (axisW < MIN_AXIS_W) return null;
  if (positions.length === 0) return null;

  const chips: { key: string; y: number; price: number; color: string }[] = [];
  for (const d of positions) {
    const entryColor = d.color ?? TV_PINE.neutral;
    const stopColor = d.stopColor ?? TV_PINE.red;
    const targetColor = d.targetColor ?? TV_PINE.green;
    const levels: [number, string, string][] = [
      [d.entry, entryColor, "entry"],
      [d.stop, stopColor, "stop"],
      [d.target, targetColor, "target"],
    ];
    for (const [price, color, label] of levels) {
      const y = candleSeries.priceToCoordinate(price);
      if (y === null) continue;
      chips.push({ key: `${d.id}-${label}`, y, price, color });
    }
  }
  if (chips.length === 0) return null;

  return (
    <>
      {chips.map((c) => {
        let top = c.y - CHIP_H / 2;
        top = Math.max(0, Math.min(top, mainPaneHeight - CHIP_H));
        return (
          <div
            key={c.key}
            className="pointer-events-none absolute z-10 flex items-center justify-center rounded-sm text-[10px] font-semibold tabular-nums leading-none"
            style={{
              left: plotW + 1,
              top,
              width: axisW - 2,
              height: CHIP_H,
              backgroundColor: c.color,
              color: TV_PINE.pillText,
            }}
          >
            {formatPrice(c.price)}
          </div>
        );
      })}
    </>
  );
}
