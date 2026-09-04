"use client";

import { useEffect, useRef } from "react";
import type { ISeriesApi, IPriceLine } from "lightweight-charts";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { cleanSym } from "@/lib/binance/rest";

const LIMIT_COLOR = "#2962ff";
const SELL_COLOR = "#ff5252";
const TP_COLOR = "#26a69a";
const SL_COLOR = "#fbc02d";
const LIQ_COLOR = "#ff5252";

interface Level {
  id: string;
  price: number;
  color: string;
  title: string;
}

/**
 * Thin paper-mode adapter for `OrderLinesLayer`: shows resting paper limit
 * orders and the open paper position's entry/TP/SL/liquidation on the chart,
 * using lightweight-charts' native price lines only — no draggable SVG
 * toolbar, no right-click "modify" menu. `OrderLinesLayer` itself is deeply
 * coupled to `trading-store` (form previews, drag-to-modify, position edit
 * dialogs — none of which exist for paper positions yet, see issue #7 for
 * the positions table), so forking its ~1300 lines for read-only lines would
 * be far more surface than this needs. Native price lines already give the
 * same color-matched axis label `OrderLinesLayer` relies on; dragging a
 * paper order's line is a natural follow-up once #7 lands the panel that
 * would receive the edit.
 */
export function PaperOrderLinesLayer({
  candleSeries,
  symbol,
}: {
  candleSeries: ISeriesApi<"Candlestick"> | null;
  symbol: string;
}) {
  const orders = usePaperTradingStore((s) => s.account.orders);
  const positions = usePaperTradingStore((s) => s.account.positions);

  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());

  useEffect(() => {
    if (!candleSeries) return;
    const cleaned = cleanSym(symbol);
    const levels: Level[] = [];

    for (const order of orders) {
      if (order.symbol !== cleaned || order.status !== "NEW") continue;
      levels.push({
        id: order.id,
        price: order.price,
        color: order.side === "BUY" ? LIMIT_COLOR : SELL_COLOR,
        title: `${order.side} ${order.qty} (paper)`,
      });
    }

    for (const pos of positions) {
      if (pos.symbol !== cleaned) continue;
      const long = pos.side === "LONG";
      levels.push({
        id: `${pos.id}-EP`,
        price: pos.entryPrice,
        color: long ? LIMIT_COLOR : SELL_COLOR,
        title: `${pos.side} ${pos.qty} (paper)`,
      });
      if (pos.tp !== null) {
        levels.push({ id: `${pos.id}-TP`, price: pos.tp, color: TP_COLOR, title: "TP (paper)" });
      }
      if (pos.sl !== null) {
        levels.push({ id: `${pos.id}-SL`, price: pos.sl, color: SL_COLOR, title: "SL (paper)" });
      }
      if (pos.liquidationPrice > 0) {
        levels.push({
          id: `${pos.id}-LIQ`,
          price: pos.liquidationPrice,
          color: LIQ_COLOR,
          title: "Liq. (paper)",
        });
      }
    }

    const map = priceLinesRef.current;
    const seen = new Set<string>();
    for (const lvl of levels) {
      seen.add(lvl.id);
      const existing = map.get(lvl.id);
      if (existing) {
        existing.applyOptions({ price: lvl.price, color: lvl.color, title: lvl.title });
      } else {
        map.set(
          lvl.id,
          candleSeries.createPriceLine({
            price: lvl.price,
            color: lvl.color,
            lineWidth: 1,
            lineStyle: 2, // Dashed — visually distinct from a live order's solid line.
            axisLabelVisible: true,
            lineVisible: true,
            title: lvl.title,
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
  }, [candleSeries, orders, positions, symbol]);

  // Drop all price lines when the series itself goes away (symbol/chart teardown).
  useEffect(() => {
    const map = priceLinesRef.current;
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

  return null;
}
