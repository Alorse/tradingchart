"use client";

import { useMemo, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { stripExchangePrefix } from "@/lib/symbols/prefix";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { formatPnlDisplay, positionFiguresAt } from "@/lib/trading/paper-position-display";
import type { PaperPositionFigures, PnlDisplayMode } from "@/lib/trading/paper-position-display";
import { useSeriesPriceLines, type PriceLineLevel } from "@/lib/chart/price-lines";
import {
  CHIP_HEIGHT,
  LIQ_COLOR,
  SL_COLOR,
  TP_COLOR,
  entryLineColor,
  layoutChipsRightToLeft,
  outlineChip,
  pnlCloseChip,
  solidChip,
} from "./chart-chips";
import type { Chip } from "./chart-chips";
import {
  ClosePositionDialog,
  EditPositionDialog,
  ReversePositionDialog,
} from "@/components/layout/PaperPositionsPanel";
import type { PaperPosition } from "@/lib/trading/paper-engine";

/**
 * Paper-mode adapter for `OrderLinesLayer`: native price lines for resting
 * limit orders and the open paper position's TP/SL/liquidation (unchanged —
 * these stay read-only, dashed for orders, solid side-colored for the
 * position), PLUS an interactive SVG toolbar on the entry line for the
 * charted symbol's position — side chip, qty, live uPnL (in whichever
 * `pnlDisplayMode` the panel is set to), and inline Edit TP/SL, Reverse and
 * Close buttons. No drag-to-modify in this pass (see CLAUDE.md/issue #7) —
 * every button opens the same dialog the positions panel uses, so there is
 * exactly one implementation of each confirmation flow.
 */
export function PaperOrderLinesLayer({
  chart,
  candleSeries,
  width,
  mainPaneHeight,
  renderTick,
  symbol,
}: {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  width: number;
  mainPaneHeight: number;
  renderTick: number;
  symbol: string;
}) {
  // Forces a re-render (and a fresh `priceToCoordinate` read) on chart
  // pan/zoom, same as `OrderLinesLayer` — a price-scale rescale moves the
  // entry toolbar's y position without touching any of our own state.
  void renderTick;
  // The key positions/orders are stored under: exchange prefix stripped,
  // `.P` kept, so a spot chart never draws the perp position's lines.
  const key = stripExchangePrefix(symbol);
  const orders = usePaperTradingStore((s) => s.account.orders);
  const positions = usePaperTradingStore((s) => s.account.positions);
  // Just this symbol's mark, not the whole map: `marks` gets a fresh identity
  // whenever *any* exposed symbol ticks, so subscribing it re-rendered this
  // layer (and re-ran the chip layout) for a position on another chart.
  const mark = usePaperTradingStore((s) => s.marks[key]);
  const pnlDisplayMode = usePaperTradingStore((s) => s.pnlDisplayMode);

  const [editing, setEditing] = useState<PaperPosition | null>(null);
  const [closing, setClosing] = useState<PaperPosition | null>(null);
  const [reversing, setReversing] = useState<PaperPosition | null>(null);

  const chartedPosition = positions.find((p) => p.symbol === key) ?? null;
  const tickSize = useSymbolInfo(symbol).tickSize;

  // Native price lines for every resting order and every position's
  // EP/TP/SL/liquidation — reconciled onto the series by `useSeriesPriceLines`.
  const levels = useMemo(() => {
    const out: PriceLineLevel[] = [];

    for (const order of orders) {
      if (order.symbol !== key || order.status !== "NEW") continue;
      out.push({
        id: order.id,
        price: order.price,
        color: entryLineColor(order.side === "BUY"),
        title: `${order.side} ${order.qty} (paper)`,
      });
    }

    for (const pos of positions) {
      if (pos.symbol !== key) continue;
      // The entry line itself is drawn by the SVG toolbar below when this is
      // the charted symbol's position — a native line here too would just be
      // a second, chip-less copy sitting under it. Every OTHER symbol's
      // position (there is at most one per symbol) still gets its native EP
      // line, same as before.
      if (pos.id !== chartedPosition?.id) {
        out.push({
          id: `${pos.id}-EP`,
          price: pos.entryPrice,
          color: entryLineColor(pos.side === "LONG"),
          title: `${pos.side} ${pos.qty} (paper)`,
        });
      }
      if (pos.tp !== null) {
        out.push({ id: `${pos.id}-TP`, price: pos.tp, color: TP_COLOR, title: "TP (paper)" });
      }
      if (pos.sl !== null) {
        out.push({ id: `${pos.id}-SL`, price: pos.sl, color: SL_COLOR, title: "SL (paper)" });
      }
      if (pos.liquidationPrice > 0) {
        out.push({
          id: `${pos.id}-LIQ`,
          price: pos.liquidationPrice,
          color: LIQ_COLOR,
          title: "Liq. (paper)",
        });
      }
    }
    return out;
  }, [orders, positions, key, chartedPosition?.id]);

  // Dashed, so a simulated level is visually distinct from a live order's.
  useSeriesPriceLines(candleSeries, levels, 2);

  if (!chart || !candleSeries || !chartedPosition) return null;

  // Same figures the positions panel renders, from the same helper.
  const figures = positionFiguresAt(chartedPosition, mark, pnlDisplayMode, tickSize);
  const y = candleSeries.priceToCoordinate(chartedPosition.entryPrice);
  const plotW = chart.timeScale().width() || width;

  return (
    <>
      {y !== null && y >= 0 && y <= mainPaneHeight && (
        <svg
          className="pointer-events-none absolute inset-0 z-20 h-full w-full"
          style={{ overflow: "visible" }}
        >
          <g style={{ pointerEvents: "all" }}>
            <EntryToolbarRow
              y={y}
              width={plotW}
              position={chartedPosition}
              figures={figures}
              pnlDisplayMode={pnlDisplayMode}
              onEdit={() => setEditing(chartedPosition)}
              onReverse={() => setReversing(chartedPosition)}
              onClose={() => setClosing(chartedPosition)}
            />
          </g>
        </svg>
      )}
      {editing && <EditPositionDialog position={editing} onOpenChange={(open) => !open && setEditing(null)} />}
      {closing && (
        <ClosePositionDialog
          position={closing}
          initialQty={closing.qty}
          onOpenChange={(open) => !open && setClosing(null)}
        />
      )}
      {reversing && (
        <ReversePositionDialog position={reversing} onOpenChange={(open) => !open && setReversing(null)} />
      )}
    </>
  );
}

/**
 * The paper position's entry line: a TradingView-style chip toolbar — side +
 * qty, live uPnL, and [Edit] [Reverse] [×] buttons — laid out right-to-left
 * like `OrderLinesLayer`'s `EntryToolbarRow`, but with no drag handling and
 * every action opening a dialog instead of manipulating the line directly.
 */
function EntryToolbarRow({
  y, width, position, figures, pnlDisplayMode, onEdit, onReverse, onClose,
}: {
  y: number;
  width: number;
  position: PaperPosition;
  figures: PaperPositionFigures;
  pnlDisplayMode: PnlDisplayMode;
  onEdit: () => void;
  onReverse: () => void;
  onClose: () => void;
}) {
  const H = CHIP_HEIGHT;
  const yTop = y - 10;
  const isLong = position.side === "LONG";
  const entryColor = entryLineColor(isLong);
  const pnlColor = figures.pnl >= 0 ? TP_COLOR : LIQ_COLOR;
  const pnlStr = formatPnlDisplay(figures.displayPnl, pnlDisplayMode);

  const chips: Chip[] = [];

  // Rightmost: P&L merged with the close (×) button into one outlined box.
  chips.push(pnlCloseChip({ y, yTop, h: H, pnlStr, pnlColor, borderColor: entryColor, onClose }));

  chips.push(outlineChip({
    key: "reverse", label: "⇄", color: entryColor, y, yTop, h: H, fontSize: 12, onClick: onReverse,
  }));

  chips.push(outlineChip({
    key: "edit", label: "TP/SL", color: entryColor, y, yTop, h: H, dashed: true, onClick: onEdit,
  }));

  // Side + qty chip (solid).
  chips.push(solidChip({
    key: "size",
    label: `${isLong ? "Long" : "Short"} ${position.qty}`,
    fill: entryColor,
    y, yTop, h: H,
  }));

  const { placed, lineEnd } = layoutChipsRightToLeft(chips, width);

  return (
    <g>
      <line x1={0} x2={lineEnd} y1={y} y2={y} stroke={entryColor} strokeWidth={1.6} style={{ pointerEvents: "none" }} />
      {placed}
    </g>
  );
}
