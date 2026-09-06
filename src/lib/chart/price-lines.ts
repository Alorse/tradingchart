import { useEffect, useRef } from "react";
import type { IPriceLine, ISeriesApi } from "lightweight-charts";

/** One native price line, keyed by a stable `id` across renders. */
export interface PriceLineLevel {
  id: string;
  price: number;
  color: string;
  /** Shown inline on the line itself; the price-scale label is always on. */
  title?: string;
}

/**
 * Keeps a candle series' native lightweight-charts price lines in sync with a
 * declarative list of levels: reuse-by-id via `applyOptions`, create what's
 * new, remove what's gone, and drop everything when the series is torn down.
 *
 * Both chart order layers (`OrderLinesLayer` for the live account,
 * `PaperOrderLinesLayer` for the simulated one) drew these themselves with the
 * same seen-set loop and the same disposal-guarded teardown; price-line
 * lifecycle is not a live-vs-paper concern, so it lives here instead — the
 * same reasoning that moved the chip geometry into `chart-chips.ts`. The
 * layers keep only their own pure "positions/orders → levels" function.
 *
 * Native lines are used alongside the SVG overlay because they're painted on
 * the chart's own canvas: always in sync with no React-render lag, spanning
 * the full pane width, and carrying a colour-matched price-scale label.
 *
 * `levels` must be memoized — it is the effect's dependency.
 */
export function useSeriesPriceLines(
  candleSeries: ISeriesApi<"Candlestick"> | null,
  levels: PriceLineLevel[],
  /** `0` solid (live orders), `2` dashed (paper, visually distinct). */
  lineStyle: 0 | 2,
) {
  const linesRef = useRef<Map<string, IPriceLine>>(new Map());

  useEffect(() => {
    if (!candleSeries) return;
    const map = linesRef.current;
    const seen = new Set<string>();
    for (const lvl of levels) {
      seen.add(lvl.id);
      const existing = map.get(lvl.id);
      if (existing) {
        existing.applyOptions({ price: lvl.price, color: lvl.color, title: lvl.title ?? "" });
      } else {
        map.set(
          lvl.id,
          candleSeries.createPriceLine({
            price: lvl.price,
            color: lvl.color,
            lineWidth: 1,
            lineStyle,
            axisLabelVisible: true,
            lineVisible: true,
            title: lvl.title ?? "",
          }),
        );
      }
    }
    for (const [id, line] of map) {
      if (!seen.has(id)) {
        candleSeries.removePriceLine(line);
        map.delete(id);
      }
    }
  }, [candleSeries, levels, lineStyle]);

  // Drop every line when the series itself goes away (symbol/chart teardown).
  useEffect(() => {
    const map = linesRef.current;
    return () => {
      if (!candleSeries) return;
      for (const line of map.values()) {
        try {
          candleSeries.removePriceLine(line);
        } catch {
          // series may already be disposed
        }
      }
      map.clear();
    };
  }, [candleSeries]);
}
