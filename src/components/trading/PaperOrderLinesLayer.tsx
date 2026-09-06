"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, IPriceLine } from "lightweight-charts";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { stripExchangePrefix } from "@/lib/symbols/prefix";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { unrealizedPnl } from "@/lib/trading/paper-engine";
import { formatPnlDisplay, pnlDisplayValue } from "@/lib/trading/paper-position-display";
import type { PnlDisplayMode } from "@/lib/trading/paper-position-display";
import { TV_PINE } from "@/lib/chart/theme";
import { CHIP_HEIGHT, chipWidth, layoutChipsRightToLeft, stopEvt } from "./chart-chips";
import type { Chip } from "./chart-chips";
import {
  ClosePositionDialog,
  EditPositionDialog,
  ReversePositionDialog,
} from "@/components/layout/PaperPositionsPanel";
import type { PaperPosition } from "@/lib/trading/paper-engine";

/** Same five as `OrderLinesLayer` — both read them from the one Pine set. */
const LIMIT_COLOR = TV_PINE.blue;
const SELL_COLOR = TV_PINE.liquidation;
const TP_COLOR = TV_PINE.green;
const SL_COLOR = TV_PINE.amber;
const LIQ_COLOR = TV_PINE.liquidation;

interface Level {
  id: string;
  price: number;
  color: string;
  title: string;
}

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
  const orders = usePaperTradingStore((s) => s.account.orders);
  const positions = usePaperTradingStore((s) => s.account.positions);
  const marks = usePaperTradingStore((s) => s.marks);
  const pnlDisplayMode = usePaperTradingStore((s) => s.pnlDisplayMode);

  const [editing, setEditing] = useState<PaperPosition | null>(null);
  const [closing, setClosing] = useState<PaperPosition | null>(null);
  const [reversing, setReversing] = useState<PaperPosition | null>(null);

  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());

  // The key positions/orders are stored under: exchange prefix stripped,
  // `.P` kept, so a spot chart never draws the perp position's lines.
  const key = stripExchangePrefix(symbol);
  const chartedPosition = positions.find((p) => p.symbol === key) ?? null;
  const tickSize = useSymbolInfo(symbol).tickSize;

  useEffect(() => {
    if (!candleSeries) return;
    const levels: Level[] = [];

    for (const order of orders) {
      if (order.symbol !== key || order.status !== "NEW") continue;
      levels.push({
        id: order.id,
        price: order.price,
        color: order.side === "BUY" ? LIMIT_COLOR : SELL_COLOR,
        title: `${order.side} ${order.qty} (paper)`,
      });
    }

    for (const pos of positions) {
      if (pos.symbol !== key) continue;
      const long = pos.side === "LONG";
      // The entry line itself is drawn by the SVG toolbar below when this is
      // the charted symbol's position — a native line here too would just be
      // a second, chip-less copy sitting under it. Every OTHER symbol's
      // position (there is at most one per symbol) still gets its native EP
      // line, same as before.
      if (pos.id !== chartedPosition?.id) {
        levels.push({
          id: `${pos.id}-EP`,
          price: pos.entryPrice,
          color: long ? LIMIT_COLOR : SELL_COLOR,
          title: `${pos.side} ${pos.qty} (paper)`,
        });
      }
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
  }, [candleSeries, orders, positions, key, chartedPosition?.id]);

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

  if (!chart || !candleSeries || !chartedPosition) return null;

  const mark = marks[chartedPosition.symbol] ?? chartedPosition.entryPrice;
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
              mark={mark}
              tickSize={tickSize}
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
  y, width, position, mark, tickSize, pnlDisplayMode, onEdit, onReverse, onClose,
}: {
  y: number;
  width: number;
  position: PaperPosition;
  mark: number;
  tickSize: number;
  pnlDisplayMode: PnlDisplayMode;
  onEdit: () => void;
  onReverse: () => void;
  onClose: () => void;
}) {
  const H = CHIP_HEIGHT;
  const yTop = y - 10;
  const isLong = position.side === "LONG";
  const entryColor = isLong ? LIMIT_COLOR : SELL_COLOR;
  const pnl = unrealizedPnl(position, mark);
  const displayPnl = pnlDisplayValue(position, mark, pnlDisplayMode, tickSize);
  const pnlColor = pnl >= 0 ? TP_COLOR : LIQ_COLOR;
  const pnlStr = formatPnlDisplay(displayPnl, pnlDisplayMode);

  const chips: Chip[] = [];

  // Rightmost: P&L merged with the close (×) button into one outlined box.
  const pnlW = chipWidth(pnlStr);
  const closeW = 20;
  const mergedW = pnlW + closeW;
  chips.push({
    w: mergedW,
    el: (x) => (
      <g key="pnl-close">
        <rect x={x} y={yTop} width={mergedW} height={H} rx={3} fill={TV_PINE.pillFill} stroke={entryColor} />
        <text x={x + pnlW / 2} y={y + 4} fill={pnlColor} fontSize={11} fontFamily="var(--font-mono), monospace" textAnchor="middle">{pnlStr}</text>
        <line x1={x + pnlW} x2={x + pnlW} y1={yTop} y2={yTop + H} stroke={entryColor} strokeWidth={1} />
        <text x={x + pnlW + closeW / 2} y={y + 4} fill={entryColor} fontSize={13} fontWeight="bold" textAnchor="middle">×</text>
        <rect
          x={x + pnlW}
          y={yTop}
          width={closeW}
          height={H}
          fill="transparent"
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onMouseDown={stopEvt}
          onClick={(e) => { stopEvt(e); onClose(); }}
        />
      </g>
    ),
  });

  // Reverse (⇄) button.
  const reverseW = 24;
  chips.push({
    w: reverseW,
    el: (x) => (
      <g
        key="reverse"
        style={{ pointerEvents: "all", cursor: "pointer" }}
        onMouseDown={stopEvt}
        onClick={(e) => { stopEvt(e); onReverse(); }}
      >
        <rect x={x} y={yTop} width={reverseW} height={H} rx={3} fill={TV_PINE.pillFill} stroke={entryColor} />
        <text x={x + reverseW / 2} y={y + 4} fill={entryColor} fontSize={12} fontWeight="bold" textAnchor="middle">⇄</text>
      </g>
    ),
  });

  // Edit TP/SL button.
  const editW = chipWidth("TP/SL");
  chips.push({
    w: editW,
    el: (x) => (
      <g
        key="edit"
        style={{ pointerEvents: "all", cursor: "pointer" }}
        onMouseDown={stopEvt}
        onClick={(e) => { stopEvt(e); onEdit(); }}
      >
        <rect x={x} y={yTop} width={editW} height={H} rx={3} fill={TV_PINE.pillFill} stroke={entryColor} strokeDasharray="3,2" />
        <text x={x + editW / 2} y={y + 4} fill={entryColor} fontSize={11} fontWeight="bold" textAnchor="middle">TP/SL</text>
      </g>
    ),
  });

  // Side + qty chip (solid).
  const sizeStr = `${isLong ? "Long" : "Short"} ${position.qty}`;
  const sizeW = chipWidth(sizeStr);
  chips.push({
    w: sizeW,
    el: (x) => (
      <g key="size">
        <rect x={x} y={yTop} width={sizeW} height={H} rx={3} fill={entryColor} />
        <text x={x + sizeW / 2} y={y + 4} fill={TV_PINE.white} fontSize={11} fontWeight="bold" fontFamily="var(--font-mono), monospace" textAnchor="middle">{sizeStr}</text>
      </g>
    ),
  });

  const { placed, lineEnd } = layoutChipsRightToLeft(chips, width);

  return (
    <g>
      <line x1={0} x2={lineEnd} y1={y} y2={y} stroke={entryColor} strokeWidth={1.6} style={{ pointerEvents: "none" }} />
      {placed}
    </g>
  );
}
