"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IChartApi, ISeriesApi, IPriceLine } from "lightweight-charts";
import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { isPerp, cleanSym } from "@/lib/binance/rest";
import { resolveSource } from "@/lib/symbols/source";
import { formatPrice } from "@/lib/format";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { pnlAtExit } from "@/lib/trading/sizing";
import type { Order, Position } from "@/lib/binance/trading-types";
import { TV_PINE } from "@/lib/chart/theme";

/** Bybit-style colors. Limit is always blue regardless of side. */
const LIMIT_COLOR = TV_PINE.blue;
const TP_COLOR = TV_PINE.green;
const SL_COLOR = TV_PINE.amber;
const LIQ_COLOR = TV_PINE.liquidation;
/** Gap kept between the labels/toolbar and the price scale on the right. */
const AXIS_GAP = 48;

interface Props {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
  width: number;
  mainPaneHeight: number;
  renderTick: number;
}

interface LineSpec {
  kind: "LIMIT" | "TP" | "SL" | "LIQ";
  /** Stable identity for two-step (drag → confirm) editable lines. */
  id?: string;
  price: number;
  /** Quantity in base asset shown on the pill. */
  qty: number;
  /**
   * Side of the POSITION this line belongs to (BUY = long), not of the
   * reduceOnly order that implements it — that one points the other way, and
   * would invert the sign of every TP/SL P&L. Only meaningful alongside
   * `entryPrice`; lines without one show a price instead of a P&L.
   */
  side: "BUY" | "SELL";
  /** Optional anchor entry price used to compute USD P&L for TP/SL pills. */
  entryPrice?: number;
  /** Live unrealized P&L in USD (open positions only) shown on the EP pill. */
  livePnl?: number;
  /** How far price has moved from the entry, in percent — NOT the leveraged
   *  ROI. Matches what TradingView shows on the position line. */
  livePct?: number;
  /** Drag handler. If undefined the line is read-only. */
  onDrag?: (price: number) => void;
  /** Optional commit when drag ends — used by drag-to-modify on open orders. */
  onCommit?: (price: number) => void;
  /** Two-step commit: called when the user confirms a pending dragged change. */
  confirm?: (price: number) => Promise<void> | void;
  /** Optional close action — renders a close (×) button on the line (EP line). */
  onClose?: () => void;
  /** Optional remove action — renders a small × chip that clears this value
   *  entirely (e.g. clear the SL). */
  onRemove?: () => void;
  /** Text shown in a small popup while hovering this line's pill. */
  tooltip?: string;
  /** Marks the not-yet-placed order being staged in the form. Renders its own
   *  chip toolbar ([Buy] [TP] [SL] [qty] [Limit] [×]) instead of a plain pill. */
  isPreviewOrder?: boolean;
  /** Order type shown on the preview toolbar (e.g. "Limit", "Stop"). */
  typeLabel?: string;
  /** Press-and-drag handlers for the TP/SL placement chips. Only set while the
   *  corresponding bracket is unset. */
  onPlaceTp?: (e: React.MouseEvent) => void;
  onPlaceSl?: (e: React.MouseEvent) => void;
  /** Dismiss the staged order (clears the preview line from the chart). */
  onCancel?: () => void;
  /** When true, render the line in a "modifying…" muted style. */
  modifying?: boolean;
  /** When true, the line represents an OPEN POSITION (uses "EP" label and
   *  solid styling). Distinguishes from a pending limit order. */
  isPosition?: boolean;
  /** Right-click handler — currently only wired for a position's TP/SL lines,
   *  opening a small "Modify order… / Remove" menu. */
  onContextMenu?: (e: React.MouseEvent) => void;
}

function colorOf(kind: LineSpec["kind"]): string {
  switch (kind) {
    case "LIMIT": return LIMIT_COLOR;
    case "TP":    return TP_COLOR;
    case "SL":    return SL_COLOR;
    case "LIQ":   return LIQ_COLOR;
  }
}

function pillText(line: LineSpec): { left: string; right: string } {
  const qtyStr = line.qty > 0 ? line.qty.toString() : "";
  if (line.kind === "LIQ") {
    return { left: "Liq.", right: formatPrice(line.price) };
  }
  if (line.kind === "LIMIT") {
    if (line.isPosition) {
      // Open position line: side + qty on the left, live PnL (USD + %) on the right.
      const pnl =
        line.livePnl !== undefined
          ? `${line.livePnl >= 0 ? "+" : "−"}${Math.abs(line.livePnl).toFixed(2)} USD`
          : "";
      const pct =
        line.livePct !== undefined
          ? ` (${line.livePct >= 0 ? "+" : ""}${line.livePct.toFixed(2)}%)`
          : "";
      return {
        left: `${line.side === "BUY" ? "Long" : "Short"} ${qtyStr}`.trim(),
        right: `${pnl}${pct}`,
      };
    }
    return {
      left: `${line.side} ${qtyStr}`.trim(),
      right: `Limit ${formatPrice(line.price)}`,
    };
  }
  if (line.entryPrice && line.qty > 0) {
    // Signed by direction, not by which bracket this is: a stop moved past the
    // entry (above it on a long, below it on a short) locks in a gain, so it
    // has to read positive. Hardcoding "−" for SL made that case say the
    // opposite of what the trade would actually pay out.
    const pnl = pnlAtExit(line.entryPrice, line.price, line.qty, line.side);
    const sign = pnl >= 0 ? "+" : "−";
    // Only the USD amount on TP/SL pills — the size lives on the entry toolbar.
    return {
      left: "",
      right: `${sign}${Math.abs(pnl).toFixed(2)} USD`,
    };
  }
  return {
    left: line.kind,
    right: formatPrice(line.price),
  };
}

interface DragState {
  onDrag: (p: number) => void;
  onCommit?: (p: number) => void;
  lastPrice: number;
}

function LineRow({
  line, y, width, modifying, onMouseDown,
}: {
  line: LineSpec;
  y: number;
  width: number;
  modifying: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = colorOf(line.kind);
  // Open-position lines (EP/SL/TP/liq) are solid like TradingView; only pending
  // orders and form previews stay dashed.
  const dashed = !line.isPosition && line.kind !== "LIMIT";
  const { left, right } = pillText(line);
  const label = modifying ? "Modifying…" : [left, right].filter(Boolean).join(" · ");
  const labelW = Math.max(label.length * 6.8 + 14, 94);
  // Only one action button applies per line in practice (onRemove for SL/TP,
  // onClose reserved for future use) — prefer onRemove.
  const action = !modifying ? (line.onRemove ?? line.onClose) : undefined;
  const hasAction = !!action;
  const actionW = hasAction ? 20 : 0;
  // SL pills are outlined: black fill, yellow border + yellow text. Others use a
  // solid colored fill with light text.
  const outlined = line.kind === "SL";
  const pillFill = outlined ? TV_PINE.pillFill : color;
  const pillStroke = outlined ? color : "none";
  const textColor = outlined ? color : TV_PINE.white;
  // The label + action button are drawn as ONE continuous box (rounded rect),
  // separated by a thin divider line, instead of two separate boxes with a gap.
  const boxRight = width - AXIS_GAP;
  const boxLeft = boxRight - labelW - actionW;
  const dividerX = boxRight - actionW;

  return (
    <g style={{ opacity: modifying ? 0.55 : 1 }}>
      {/* Hit area for drag */}
      <line
        x1={0}
        x2={width}
        y1={y}
        y2={y}
        stroke="transparent"
        strokeWidth={10}
        style={{
          pointerEvents: line.onDrag ? "stroke" : "none",
          cursor: line.onDrag ? "ns-resize" : "default",
        }}
        onMouseDown={onMouseDown}
      />
      {/* Visible line */}
      <line
        x1={0}
        x2={boxLeft - 4}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth={line.isPosition && line.kind === "LIMIT" ? 1.6 : 1.2}
        strokeDasharray={dashed ? "5,4" : undefined}
        style={{ pointerEvents: "none" }}
      />
      {/* Merged box: label + (optional) action button */}
      <rect
        x={boxLeft}
        y={y - 10}
        width={boxRight - boxLeft}
        height={20}
        fill={pillFill}
        stroke={pillStroke}
        rx={2}
        style={{
          pointerEvents: line.tooltip || line.onContextMenu ? "all" : "none",
          cursor: line.onContextMenu ? "context-menu" : undefined,
        }}
        onMouseEnter={() => line.tooltip && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={line.onContextMenu}
      />
      <text
        x={boxLeft + (dividerX - boxLeft) / 2}
        y={y + 4}
        fill={textColor}
        fontSize={11}
        fontFamily="var(--font-mono), monospace"
        textAnchor="middle"
        style={{ pointerEvents: "none" }}
      >
        {label}
      </text>
      {hasAction && (
        <>
          {/* Thin divider between the label and the action button */}
          <line
            x1={dividerX}
            x2={dividerX}
            y1={y - 10}
            y2={y + 10}
            stroke={pillStroke !== "none" ? pillStroke : "#00000055"}
            strokeWidth={1}
            style={{ pointerEvents: "none" }}
          />
          <text
            x={dividerX + actionW / 2}
            y={y + 4}
            fill={textColor}
            fontSize={13}
            fontWeight="bold"
            textAnchor="middle"
            style={{ pointerEvents: "none" }}
          >
            ×
          </text>
          <rect
            x={dividerX}
            y={y - 10}
            width={actionW}
            height={20}
            fill="transparent"
            style={{ pointerEvents: "all", cursor: "pointer" }}
            onContextMenu={line.onContextMenu}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              action?.();
            }}
          />
        </>
      )}
      {/* Hover popup (e.g. "Stop Loss -2.50%"), anchored above the pill */}
      {hovered && line.tooltip && (() => {
        const tipW = line.tooltip.length * 6.6 + 16;
        const tipX = Math.max(0, boxRight - tipW);
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={tipX}
              y={y - 34}
              width={tipW}
              height={20}
              rx={3}
              fill="var(--color-tv-popup)"
              stroke={color}
            />
            <text
              x={tipX + tipW / 2}
              y={y - 20}
              fill="var(--color-tv-text)"
              fontSize={11}
              fontFamily="var(--font-mono), monospace"
              textAnchor="middle"
            >
              {line.tooltip}
            </text>
          </g>
        );
      })()}
    </g>
  );
}

function stopEvt(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

const chipWidth = (s: string) => Math.max(s.length * 7 + 12, 24);

/**
 * "Place a TP/SL" chip. Shown only while that bracket is unset; pressing it
 * starts a drag that positions the new level (a plain click drops it at a
 * default offset), so it reads like grabbing the line straight off the button.
 */
function bracketChip(
  key: string,
  label: string,
  color: string,
  y: number,
  yTop: number,
  h: number,
  onMouseDown: (e: React.MouseEvent) => void,
) {
  const w = chipWidth(label);
  return {
    w,
    el: (x: number) => (
      <g
        key={key}
        style={{ pointerEvents: "all", cursor: "ns-resize" }}
        onMouseDown={onMouseDown}
      >
        <rect
          x={x} y={yTop} width={w} height={h} rx={3}
          fill={TV_PINE.pillFill} stroke={color} strokeDasharray="3,2"
        />
        <text
          x={x + w / 2} y={y + 4}
          fill={color} fontSize={11} fontWeight="bold" textAnchor="middle"
        >
          {label}
        </text>
      </g>
    ),
  };
}

interface PendingCtl {
  kind: "TP" | "SL";
  onConfirm: () => void;
  onDiscard: () => void;
}

/**
 * TradingView-style position toolbar rendered on the entry line: a right-aligned
 * row of chips — [Discard] [Confirm] [TP/SL] [size] [P&L %] [×] — where the
 * Discard/Confirm/tag chips only appear while a TP/SL drag is pending.
 */
function EntryToolbarRow({
  y, width, qty, side, pnlPct, onClose, pending, onPlaceTp, onPlaceSl,
}: {
  y: number;
  width: number;
  qty: number;
  side: "BUY" | "SELL";
  pnlPct: number;
  onClose?: () => void;
  pending: PendingCtl | null;
  /** Present only while that bracket is unset — press-and-drag to place it. */
  onPlaceTp?: (e: React.MouseEvent) => void;
  onPlaceSl?: (e: React.MouseEvent) => void;
}) {
  const H = 20;
  const GAP = 4;
  const yTop = y - 10;
  const chips: { w: number; el: (x: number) => React.ReactNode }[] = [];
  // Short entries read red end-to-end (line, chips) instead of the long's
  // blue, so the direction is legible at a glance without reading the label.
  const entryColor = side === "SELL" ? LIQ_COLOR : LIMIT_COLOR;

  // P&L percent merged with the close (×) button into ONE continuous outlined
  // box (black fill, blue border), separated by a thin divider — not two
  // separate boxes with a gap.
  const pnlStr = `${pnlPct >= 0 ? "+" : "−"}${Math.abs(pnlPct).toFixed(2)}%`;
  const pnlColor = pnlPct >= 0 ? TP_COLOR : LIQ_COLOR;
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
          onClick={(e) => { stopEvt(e); onClose?.(); }}
        />
      </g>
    ),
  });

  // Position size.
  const sizeStr = String(qty);
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

  // Bracket placement chips, to the left of the size chip.
  if (onPlaceSl) chips.push(bracketChip("place-sl", "SL", SL_COLOR, y, yTop, H, onPlaceSl));
  if (onPlaceTp) chips.push(bracketChip("place-tp", "TP", TP_COLOR, y, yTop, H, onPlaceTp));

  if (pending) {
    const tagColor = pending.kind === "TP" ? TP_COLOR : SL_COLOR;
    const tagW = chipWidth(pending.kind);
    chips.push({
      w: tagW,
      el: (x) => (
        <g key="tag">
          <rect x={x} y={yTop} width={tagW} height={H} rx={3} fill="none" stroke={tagColor} strokeDasharray="3,2" />
          <text x={x + tagW / 2} y={y + 4} fill={tagColor} fontSize={11} fontWeight="bold" textAnchor="middle">{pending.kind}</text>
        </g>
      ),
    });
    chips.push({
      w: 62,
      el: (x) => (
        <g key="confirm" style={{ pointerEvents: "all", cursor: "pointer" }} onMouseDown={stopEvt}
           onClick={(e) => { stopEvt(e); pending.onConfirm(); }}>
          <rect x={x} y={yTop} width={62} height={H} rx={3} fill={entryColor} />
          <text x={x + 31} y={y + 4} fill={TV_PINE.white} fontSize={11} fontWeight="bold" textAnchor="middle">Confirm</text>
        </g>
      ),
    });
    chips.push({
      w: 62,
      el: (x) => (
        <g key="discard" style={{ pointerEvents: "all", cursor: "pointer" }} onMouseDown={stopEvt}
           onClick={(e) => { stopEvt(e); pending.onDiscard(); }}>
          <rect x={x} y={yTop} width={62} height={H} rx={3} fill="var(--color-tv-panel-hover)" stroke="var(--color-tv-border-strong)" />
          <text x={x + 31} y={y + 4} fill="var(--color-tv-text)" fontSize={11} textAnchor="middle">Discard</text>
        </g>
      ),
    });
  }

  // Lay chips out right→left, kept clear of the price scale.
  let x = width - AXIS_GAP;
  const placed: React.ReactNode[] = [];
  for (const c of chips) {
    x -= c.w;
    placed.push(c.el(x));
    x -= GAP;
  }
  const lineEnd = Math.max(0, x);

  return (
    <g>
      <line x1={0} x2={lineEnd} y1={y} y2={y} stroke={entryColor} strokeWidth={1.6} style={{ pointerEvents: "none" }} />
      {placed}
    </g>
  );
}

/**
 * Toolbar for the order being staged in the form (not yet sent to the
 * exchange): a dashed line plus [Buy] [TP] [SL] [qty] [Limit] [×] chips. The
 * TP/SL chips are press-and-drag affordances for placing those brackets, and
 * × dismisses the staged order.
 */
function PreviewOrderRow({
  y, width, qty, side, typeLabel,
  onPlaceTp, onPlaceSl, onCancel, onMouseDown,
}: {
  y: number;
  width: number;
  qty: number;
  side: "BUY" | "SELL";
  typeLabel: string;
  /** Present only while that bracket is unset — press-and-drag to place it. */
  onPlaceTp?: (e: React.MouseEvent) => void;
  onPlaceSl?: (e: React.MouseEvent) => void;
  onCancel?: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const H = 20;
  const GAP = 4;
  const yTop = y - 10;
  const chips: { w: number; el: (x: number) => React.ReactNode }[] = [];

  // Rightmost: [qty | type | ×] merged into one outlined box with dividers.
  const qtyStr = qty > 0 ? String(qty) : "—";
  const qtyW = chipWidth(qtyStr);
  const typeW = chipWidth(typeLabel);
  const closeW = 20;
  const mergedW = qtyW + typeW + closeW;
  chips.push({
    w: mergedW,
    el: (x) => (
      <g key="qty-type-close">
        <rect x={x} y={yTop} width={mergedW} height={H} rx={3} fill={TV_PINE.pillFill} stroke={LIMIT_COLOR} />
        <text x={x + qtyW / 2} y={y + 4} fill={LIMIT_COLOR} fontSize={11} fontWeight="bold" fontFamily="var(--font-mono), monospace" textAnchor="middle">{qtyStr}</text>
        <line x1={x + qtyW} x2={x + qtyW} y1={yTop} y2={yTop + H} stroke={LIMIT_COLOR} strokeWidth={1} />
        <text x={x + qtyW + typeW / 2} y={y + 4} fill={LIMIT_COLOR} fontSize={11} textAnchor="middle">{typeLabel}</text>
        <line x1={x + qtyW + typeW} x2={x + qtyW + typeW} y1={yTop} y2={yTop + H} stroke={LIMIT_COLOR} strokeWidth={1} />
        <text x={x + qtyW + typeW + closeW / 2} y={y + 4} fill={LIMIT_COLOR} fontSize={13} fontWeight="bold" textAnchor="middle">×</text>
        <rect
          x={x + qtyW + typeW}
          y={yTop}
          width={closeW}
          height={H}
          fill="transparent"
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onMouseDown={stopEvt}
          onClick={(e) => { stopEvt(e); onCancel?.(); }}
        />
      </g>
    ),
  });

  // Bracket placement chips — omitted once set (the line itself takes over) and
  // on spot, where placeOrder doesn't support brackets.
  if (onPlaceSl) chips.push(bracketChip("sl", "SL", SL_COLOR, y, yTop, H, onPlaceSl));
  if (onPlaceTp) chips.push(bracketChip("tp", "TP", TP_COLOR, y, yTop, H, onPlaceTp));

  // Side chip (solid, like TradingView's Buy/Sell tag).
  const sideLabel = side === "BUY" ? "Buy" : "Sell";
  const sideW = chipWidth(sideLabel);
  const sideColor = side === "BUY" ? LIMIT_COLOR : LIQ_COLOR;
  chips.push({
    w: sideW,
    el: (x) => (
      <g key="side">
        <rect x={x} y={yTop} width={sideW} height={H} rx={3} fill={sideColor} />
        <text x={x + sideW / 2} y={y + 4} fill={TV_PINE.white} fontSize={11} fontWeight="bold" textAnchor="middle">{sideLabel}</text>
      </g>
    ),
  });

  let x = width - AXIS_GAP;
  const placed: React.ReactNode[] = [];
  for (const c of chips) {
    x -= c.w;
    placed.push(c.el(x));
    x -= GAP;
  }
  const lineEnd = Math.max(0, x);

  return (
    <g>
      {/* Drag hit area — moves the staged order's price */}
      <line
        x1={0} x2={width} y1={y} y2={y}
        stroke="transparent" strokeWidth={10}
        style={{ pointerEvents: "stroke", cursor: "ns-resize" }}
        onMouseDown={onMouseDown}
      />
      <line
        x1={0} x2={lineEnd} y1={y} y2={y}
        stroke={LIMIT_COLOR} strokeWidth={1.2} strokeDasharray="5,4"
        style={{ pointerEvents: "none" }}
      />
      {placed}
    </g>
  );
}

interface AxisLevel {
  id: string;
  price: number;
  color: string;
}

/**
 * The reduceOnly TP/SL orders that belong to an open position.
 *
 * A position's stop can surface twice: as an order in `orders` AND as the
 * position's own `takeProfit`/`stopLoss` field. Both render at the same price
 * so they normally overlap invisibly — but the position line is draggable, so
 * a drag would leave the order's line stranded at the old price, reading as a
 * duplicate. Callers use this to render the position line only and skip the
 * order it already covers.
 */
function findTpSlOrders(
  pos: Position,
  orders: Order[],
  cleanedSym: string,
): { tpOrder?: Order; slOrder?: Order } {
  const closeSide: "BUY" | "SELL" = pos.positionAmt > 0 ? "SELL" : "BUY";
  const owns = (o: Order) =>
    o.symbol === cleanedSym && o.side === closeSide && o.reduceOnly;
  return {
    tpOrder: orders.find(
      (o) => owns(o) && (o.type === "TAKE_PROFIT_MARKET" || o.type === "TAKE_PROFIT"),
    ),
    slOrder: orders.find(
      (o) =>
        owns(o) &&
        (o.type === "STOP_MARKET" || o.type === "STOP" || o.type === "STOP_LIMIT"),
    ),
  };
}

/**
 * Levels for the open position (EP/TP/SL/liquidation) to mirror as native
 * price lines, so the price scale shows a color-matched axis label — and the
 * line itself spans the full pane width (uncut by our custom SVG boxes),
 * continuing past them all the way to that label. Pure so it can drive a
 * useEffect dependency without recomputing coordinates (no chart/series
 * needed here, unlike the SVG-rendering pass below).
 *
 * `overrides` maps a level id to a live price, used while a TP/SL is being
 * dragged (or awaits confirmation) so the native line — and its axis label —
 * follows the drag instead of staying behind at the stored price, which would
 * otherwise read as a duplicated line.
 */
function computeAxisLevels(
  positions: Position[],
  orders: Order[],
  symbol: string,
  overrides?: Map<string, number>,
): AxisLevel[] {
  const cleanedSym = cleanSym(symbol);
  const out: AxisLevel[] = [];
  for (const pos of positions) {
    if (pos.positionAmt === 0 || pos.symbol !== cleanedSym) continue;
    out.push({
      id: `${cleanedSym}-EP`,
      price: pos.entryPrice,
      color: pos.positionAmt < 0 ? LIQ_COLOR : LIMIT_COLOR,
    });

    const { tpOrder, slOrder } = findTpSlOrders(pos, orders, cleanedSym);
    const tpPrice = pos.takeProfit ?? tpOrder?.stopPrice ?? null;
    const slPrice = pos.stopLoss ?? slOrder?.stopPrice ?? null;

    if (tpPrice && tpPrice > 0) out.push({ id: `${cleanedSym}-TP`, price: tpPrice, color: TP_COLOR });
    if (slPrice && slPrice > 0) out.push({ id: `${cleanedSym}-SL`, price: slPrice, color: SL_COLOR });
    if (pos.liquidationPrice > 0) out.push({ id: `${cleanedSym}-LIQ`, price: pos.liquidationPrice, color: LIQ_COLOR });
  }
  return overrides
    ? out.map((l) => (overrides.has(l.id) ? { ...l, price: overrides.get(l.id) as number } : l))
    : out;
}

export function OrderLinesLayer({
  chart,
  candleSeries,
  container,
  width,
  mainPaneHeight,
  renderTick,
}: Props) {
  const symbol = useChartStore((s) => s.symbol);
  const tradingExchange = useTradingStore((s) => s.exchange);
  const tradingPanelOpen = useTradingStore((s) => s.tradingPanelOpen);
  const form = useTradingStore((s) => s.form);
  // Actual tick precision for this symbol — a hardcoded 2 decimals breaks
  // dragging the preview EP/TP/SL lines on sub-$1 symbols (e.g. a $0.04
  // altcoin needs 4+ decimals just to move the price at all).
  const pricePrecision = useSymbolInfo(symbol).pricePrecision;
  const rawOrders = useTradingStore((s) => s.orders);
  const rawPositions = useTradingStore((s) => s.positions);
  const updateForm = useTradingStore((s) => s.updateForm);
  const modifyOrder = useTradingStore((s) => s.modifyOrder);
  const setPositionTpSl = useTradingStore((s) => s.setPositionTpSl);
  const closePosition = useTradingStore((s) => s.closePosition);
  const modifyingOrderId = useTradingStore((s) => s.modifyingOrderId);
  const openPositionEdit = useTradingStore((s) => s.openPositionEdit);

  // `orders`/`positions` always come from whichever exchange is connected
  // (tradingExchange), but the chart's current symbol may be showing a
  // DIFFERENT market's data — e.g. plain "SOLUSDT.P" (Binance) vs
  // "BYBIT:SOLUSDT.P" (Bybit) share the same bare ticker after cleanSym, yet
  // are different order books. Only surface this account's orders/positions
  // when the symbol on screen actually belongs to the connected exchange, so
  // a Bybit position never leaks its EP/SL lines onto the Binance chart (or
  // vice versa).
  const symbolMatchesExchange = resolveSource(symbol).kind === tradingExchange;
  const orders = symbolMatchesExchange ? rawOrders : [];
  const positions = symbolMatchesExchange ? rawPositions : [];

  // `renderTick` is already a prop from PriceChart — receiving it as a prop
  // re-renders this component on every chart pan/zoom without an extra hook.
  void renderTick;

  const dragRef = useRef<DragState | null>(null);
  // Two-step edit for position TP/SL: `preview` follows the cursor while held;
  // on release it becomes `pending` (Discard/Confirm) until the user confirms.
  const [preview, setPreview] = useState<{ id: string; price: number } | null>(null);
  const [pending, setPending] = useState<{ id: string; price: number } | null>(null);
  // Right-click menu on a position's SL/TP line: "Modify order…" opens the
  // typed editor (OrderPanel's PositionEditPanel); "Remove" clears it.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; pos: Position; field: "TP" | "SL"; onRemove: () => void;
  } | null>(null);

  // Native price lines for EP/TP/SL/liquidation: these are drawn on the chart's
  // own canvas (always in sync, no React-render lag) and span the FULL pane
  // width, so they visibly continue past our custom SVG box all the way to a
  // color-matched label on the price scale — instead of a plain last-price tag.
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  useEffect(() => {
    if (!candleSeries) return;
    // A dragged (or pending) TP/SL overrides its stored price so the native
    // line moves WITH the SVG one instead of leaving a second line behind, and
    // its axis label live-tracks the price being set.
    const overrides = new Map<string, number>();
    if (preview) overrides.set(preview.id, preview.price);
    if (pending) overrides.set(pending.id, pending.price);
    const levels = computeAxisLevels(positions, orders, symbol, overrides);
    const map = priceLinesRef.current;
    const seen = new Set<string>();
    for (const lvl of levels) {
      seen.add(lvl.id);
      const existing = map.get(lvl.id);
      if (existing) {
        existing.applyOptions({ price: lvl.price, color: lvl.color });
      } else {
        map.set(
          lvl.id,
          candleSeries.createPriceLine({
            price: lvl.price,
            color: lvl.color,
            lineWidth: 1,
            lineStyle: 0, // Solid
            axisLabelVisible: true,
            lineVisible: true,
            title: "",
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
  }, [candleSeries, positions, orders, symbol, preview, pending]);

  // Drop all price lines when the series itself goes away (symbol/chart teardown).
  useEffect(() => {
    return () => {
      if (!candleSeries) return;
      for (const line of priceLinesRef.current.values()) {
        try {
          candleSeries.removePriceLine(line);
        } catch {
          // series may already be disposed
        }
      }
      priceLinesRef.current.clear();
    };
  }, [candleSeries]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current || !candleSeries || !container) return;
      const rect = container.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const price = candleSeries.coordinateToPrice(relY);
      if (price !== null) {
        const p = price as number;
        dragRef.current.lastPrice = p;
        dragRef.current.onDrag(p);
      }
    }
    function onUp() {
      const s = dragRef.current;
      dragRef.current = null;
      if (s?.onCommit && isFinite(s.lastPrice)) s.onCommit(s.lastPrice);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [candleSeries, container]);

  function startDrag(
    e: React.MouseEvent,
    onDrag: (price: number) => void,
    onCommit?: (price: number) => void,
    /** Seeds `lastPrice` so a click that never moves still commits (used by the
     *  TP/SL placement chips, where a plain click means "use the default"). */
    initialPrice?: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { onDrag, onCommit, lastPrice: initialPrice ?? NaN };
  }

  if (!chart || !candleSeries) return null;

  // Right-align labels to the plot area's edge (left of the price scale), not the
  // full container width (which includes the ~60px price scale). Using the plot
  // width makes AXIS_GAP an actual visible gap from the scale.
  const plotW = chart.timeScale().width() || width;

  const perp = isPerp(symbol);
  const lines: LineSpec[] = [];
  const zones: { y1: number; y2: number; color: string; opacity: number }[] = [];

  /* ── Preview lines from the form (while the panel is open) ───────── */
  const entryPrice = parseFloat(form.price);
  const slPrice = parseFloat(form.sl);
  const tpPrice = parseFloat(form.tp);
  const qtyNum = parseFloat(form.qty);

  const hasPreviewEntry = tradingPanelOpen && form.type !== "MARKET" && entryPrice > 0;
  const hasPreviewSL = tradingPanelOpen && perp && form.slEnabled && slPrice > 0;
  const hasPreviewTP = tradingPanelOpen && perp && form.tpEnabled && tpPrice > 0;

  if (hasPreviewEntry) {
    // Default bracket offsets used when TP/SL is switched on from the chart —
    // a 1% stop and 2% target (RR 2), placed on the correct side of the entry.
    // They're immediately draggable, so these are just a starting point.
    const bracketPrice = (pct: number, favourable: boolean) => {
      const dir = (form.side === "BUY") === favourable ? 1 : -1;
      return (entryPrice * (1 + dir * pct)).toFixed(pricePrecision);
    };
    lines.push({
      kind: "LIMIT",
      price: entryPrice,
      qty: qtyNum || 0,
      side: form.side,
      isPreviewOrder: true,
      typeLabel:
        form.type === "STOP_LIMIT" || form.type === "STOP" ? "Stop"
        : form.type === "STOP_MARKET" ? "Stop mkt"
        : "Limit",
      // TP/SL brackets are perp-only (see placeOrder). Pressing the chip drops
      // the level at the default offset and keeps dragging it, so a plain click
      // places it and a drag positions it precisely.
      onPlaceTp:
        perp && !hasPreviewTP
          ? (e) => {
              const dflt = bracketPrice(0.02, true);
              updateForm({ tpEnabled: true, tp: dflt });
              startDrag(
                e,
                (p) => updateForm({ tpEnabled: true, tp: p.toFixed(pricePrecision) }),
                undefined,
                parseFloat(dflt),
              );
            }
          : undefined,
      onPlaceSl:
        perp && !hasPreviewSL
          ? (e) => {
              const dflt = bracketPrice(0.01, false);
              updateForm({ slEnabled: true, sl: dflt });
              startDrag(
                e,
                (p) => updateForm({ slEnabled: true, sl: p.toFixed(pricePrecision) }),
                undefined,
                parseFloat(dflt),
              );
            }
          : undefined,
      // Clearing the price drops the staged order (and its brackets) from the
      // chart without touching the panel's other settings.
      onCancel: () => updateForm({ price: "", tpEnabled: false, slEnabled: false }),
      onDrag: (p) => updateForm({ price: p.toFixed(pricePrecision) }),
    });
  }
  if (hasPreviewTP) {
    lines.push({
      kind: "TP",
      price: tpPrice,
      qty: qtyNum || 0,
      side: form.side,
      entryPrice: entryPrice || undefined,
      onRemove: () => updateForm({ tpEnabled: false }),
      onDrag: (p) => updateForm({ tp: p.toFixed(pricePrecision) }),
    });
  }
  if (hasPreviewSL) {
    lines.push({
      kind: "SL",
      price: slPrice,
      qty: qtyNum || 0,
      side: form.side,
      entryPrice: entryPrice || undefined,
      onRemove: () => updateForm({ slEnabled: false }),
      onDrag: (p) => updateForm({ sl: p.toFixed(pricePrecision) }),
    });
  }

  /* ── Lines for open orders on the exchange ──────────────────────── */
  // Orders that an open position already draws (its TP/SL) are skipped here, so
  // dragging the position's line can't leave the order's copy behind.
  const cleanedSymForOrders = cleanSym(symbol);
  const coveredOrderIds = new Set<number | string>();
  for (const pos of positions) {
    if (pos.positionAmt === 0 || pos.symbol !== cleanedSymForOrders) continue;
    const { tpOrder, slOrder } = findTpSlOrders(pos, orders, cleanedSymForOrders);
    if (tpOrder) coveredOrderIds.add(tpOrder.orderId);
    if (slOrder) coveredOrderIds.add(slOrder.orderId);
  }

  for (const order of orders) {
    // `orders` is account-wide; only draw lines for the symbol actually
    // charted, or another symbol's working order would appear on this chart.
    if (order.symbol !== cleanedSymForOrders) continue;
    if (coveredOrderIds.has(order.orderId)) continue;
    const price = order.stopPrice ?? order.price;
    if (!price || price <= 0) continue;
    const kind: LineSpec["kind"] =
      order.type === "TAKE_PROFIT_MARKET" || order.type === "TAKE_PROFIT"
        ? "TP"
        : order.type === "STOP_MARKET" || order.type === "STOP" || order.type === "STOP_LIMIT"
          ? "SL"
          : "LIMIT";

    const live = (p: number) => {
      // Update form so the panel input mirrors the dragging line if it
      // happens to be the same kind. No commit yet — that fires on mouseup.
      void p;
    };
    const commit = async (p: number) => {
      const newPrice = Math.abs(p - price) < 1e-9 ? price : p;
      if (newPrice === price) return;
      await modifyOrder(symbol, order as Order, { price: newPrice });
    };

    lines.push({
      kind,
      price,
      qty: order.origQty,
      side: order.side,
      entryPrice: undefined,
      onDrag: live,
      onCommit: commit,
      modifying: modifyingOrderId === order.orderId,
    });
  }

  /* ── Lines for open positions on the exchange ───────────────────── */
  const cleanedSym = cleanSym(symbol);
  for (const pos of positions) {
    if (pos.positionAmt === 0 || pos.symbol !== cleanedSym) continue;
    const isLong = pos.positionAmt > 0;
    const posSide: "BUY" | "SELL" = isLong ? "BUY" : "SELL";
    const qty = Math.abs(pos.positionAmt);

    // TP / SL: prefer the values attached to the position (Bybit), otherwise
    // fall back to matching reduceOnly orders (Binance). A level being dragged
    // (or awaiting confirmation) overrides the stored one — which is also what
    // makes a BRAND NEW bracket render before it exists on the exchange.
    const { tpOrder, slOrder } = findTpSlOrders(pos, orders, cleanedSym);
    const tpId = `${cleanedSym}-TP`;
    const slId = `${cleanedSym}-SL`;
    const effOf = (id: string, base: number | null) =>
      preview?.id === id ? preview.price : pending?.id === id ? pending.price : base;
    const tpPrice = pos.takeProfit ?? tpOrder?.stopPrice ?? null;
    const slPrice = pos.stopLoss ?? slOrder?.stopPrice ?? null;
    const effTp = effOf(tpId, tpPrice);
    const effSl = effOf(slId, slPrice);

    // Press-and-drag placement for a bracket the position doesn't have yet.
    const startPlace = (id: string, pct: number, favourable: boolean) =>
      (e: React.MouseEvent) => {
        const dir = isLong === favourable ? 1 : -1;
        const dflt = pos.entryPrice * (1 + dir * pct);
        setPreview({ id, price: dflt });
        startDrag(
          e,
          (p) => setPreview({ id, price: p }),
          (p) => {
            setPreview(null);
            setPending({ id, price: p });
          },
          dflt,
        );
      };

    // Entry line (read-only price, but carries live PnL + a close button).
    // The percentage shown is how far PRICE has moved from the entry — not the
    // leveraged ROI (`pos.percentage`), matching TradingView's position line.
    // The true ROI still drives the positions table. Flipped for shorts: price
    // rising is a loss on a short, so the sign has to track direction rather
    // than raw price delta, or it'd contradict the USD PnL shown right next to it.
    const rawPricePct = pos.entryPrice > 0
      ? ((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100
      : 0;
    const pricePct = isLong ? rawPricePct : -rawPricePct;
    lines.push({
      kind: "LIMIT",
      price: pos.entryPrice,
      qty,
      side: posSide,
      isPosition: true,
      livePnl: pos.unrealizedProfit,
      livePct: pricePct,
      onClose: () => void closePosition(symbol, pos),
      onPlaceTp: effTp && effTp > 0 ? undefined : startPlace(tpId, 0.02, true),
      onPlaceSl: effSl && effSl > 0 ? undefined : startPlace(slId, 0.01, false),
    });

    // Liquidation line (read-only).
    if (pos.liquidationPrice > 0) {
      lines.push({
        kind: "LIQ",
        price: pos.liquidationPrice,
        qty,
        side: posSide,
        isPosition: true,
      });
    }

    if (effTp && effTp > 0) {
      lines.push({
        kind: "TP",
        id: tpId,
        price: tpPrice ?? effTp,
        qty,
        side: posSide,
        entryPrice: pos.entryPrice,
        isPosition: true,
        onDrag: (p) => setPreview({ id: tpId, price: p }),
        onCommit: (p) => {
          setPreview(null);
          if (tpPrice === null || Math.abs(p - tpPrice) > 1e-9) setPending({ id: tpId, price: p });
        },
        confirm: async (p) => { await setPositionTpSl(symbol, pos, { tp: p }); },
        onRemove: () => {
          if (pending?.id === tpId) setPending(null);
          // A never-committed level only lives in local state — nothing to clear
          // on the exchange.
          if (tpPrice !== null) void setPositionTpSl(symbol, pos, { tp: null });
        },
        onContextMenu: (e) => {
          e.preventDefault();
          setCtxMenu({
            x: e.clientX, y: e.clientY, pos, field: "TP",
            onRemove: () => { if (tpPrice !== null) void setPositionTpSl(symbol, pos, { tp: null }); },
          });
        },
        modifying: modifyingOrderId === tpOrder?.orderId,
      });
    }
    if (effSl && effSl > 0) {
      lines.push({
        kind: "SL",
        id: slId,
        price: slPrice ?? effSl,
        qty,
        side: posSide,
        entryPrice: pos.entryPrice,
        isPosition: true,
        onDrag: (p) => setPreview({ id: slId, price: p }),
        onCommit: (p) => {
          setPreview(null);
          if (slPrice === null || Math.abs(p - slPrice) > 1e-9) setPending({ id: slId, price: p });
        },
        confirm: async (p) => { await setPositionTpSl(symbol, pos, { sl: p }); },
        onRemove: () => {
          if (pending?.id === slId) setPending(null);
          if (slPrice !== null) void setPositionTpSl(symbol, pos, { sl: null });
        },
        onContextMenu: (e) => {
          e.preventDefault();
          setCtxMenu({
            x: e.clientX, y: e.clientY, pos, field: "SL",
            onRemove: () => { if (slPrice !== null) void setPositionTpSl(symbol, pos, { sl: null }); },
          });
        },
        modifying: modifyingOrderId === slOrder?.orderId,
      });
    }

    // Shaded target zone for the open position (entry↔TP). The entry↔SL side is
    // intentionally left unshaded. While a line is being dragged/pending, the
    // zone tracks its effective price.
    const yEntryPos = candleSeries.priceToCoordinate(pos.entryPrice);
    if (yEntryPos !== null) {
      if (effTp && effTp > 0) {
        const yTp = candleSeries.priceToCoordinate(effTp);
        if (yTp !== null) {
          zones.push({
            y1: Math.min(yEntryPos as number, yTp as number),
            y2: Math.max(yEntryPos as number, yTp as number),
            color: TP_COLOR,
            opacity: 0.07,
          });
        }
      }
    }
  }

  /* ── Shaded target zone for the form preview (entry↔TP only) ── */
  if (hasPreviewEntry) {
    const yEntry = candleSeries.priceToCoordinate(entryPrice);
    if (yEntry !== null && hasPreviewTP) {
      const yTp = candleSeries.priceToCoordinate(tpPrice);
      if (yTp !== null) {
        zones.push({
          y1: Math.min(yEntry as number, yTp as number),
          y2: Math.max(yEntry as number, yTp as number),
          color: TP_COLOR,
          opacity: 0.10,
        });
      }
    }
  }

  return (
    <>
    <svg
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      style={{ overflow: "visible" }}
    >
      <defs>
        <clipPath id="order-lines-clip">
          <rect x={0} y={0} width={width} height={mainPaneHeight} />
        </clipPath>
      </defs>
      <g clipPath="url(#order-lines-clip)" style={{ pointerEvents: "all" }}>
        {/* Background shaded zones — drawn first so lines render on top */}
        {zones.map((z, i) => (
          <rect
            key={`zone-${i}`}
            x={0}
            y={z.y1}
            width={width}
            height={Math.max(0, z.y2 - z.y1)}
            fill={z.color}
            opacity={z.opacity}
            style={{ pointerEvents: "none" }}
          />
        ))}

        {/* Lines */}
        {(() => {
          // Resolve the pending (TP/SL) line so its Discard/Confirm controls can
          // be shown on the entry-price toolbar.
          const pendingLine = pending ? lines.find((l) => l.id === pending.id) : undefined;
          const pendingCtl: PendingCtl | null =
            pending && pendingLine && (pendingLine.kind === "TP" || pendingLine.kind === "SL")
              ? {
                  kind: pendingLine.kind,
                  onConfirm: () => {
                    const pr = pending.price;
                    setPending(null);
                    void pendingLine.confirm?.(pr);
                  },
                  onDiscard: () => setPending(null),
                }
              : null;

          return lines.map((line, i) => {
            // While dragging (preview) or awaiting confirmation (pending), draw the
            // line at the dragged price instead of the stored one.
            const effPrice =
              line.id && preview?.id === line.id
                ? preview.price
                : line.id && pending?.id === line.id
                  ? pending.price
                  : line.price;
            const y = candleSeries.priceToCoordinate(effPrice);
            if (y === null) return null;
            const yPx = y as number;
            if (yPx < 0 || yPx > mainPaneHeight) return null;

            // The open-position entry line renders as the chip toolbar.
            if (line.kind === "LIMIT" && line.isPosition) {
              return (
                <EntryToolbarRow
                  key={line.id ?? `entry-${i}`}
                  y={yPx}
                  width={plotW}
                  qty={line.qty}
                  side={line.side}
                  pnlPct={line.livePct ?? 0}
                  onClose={line.onClose}
                  pending={pendingCtl}
                  onPlaceTp={line.onPlaceTp}
                  onPlaceSl={line.onPlaceSl}
                />
              );
            }

            // The staged (not yet placed) order gets its own dashed toolbar.
            if (line.isPreviewOrder) {
              return (
                <PreviewOrderRow
                  key={`preview-${i}`}
                  y={yPx}
                  width={plotW}
                  qty={line.qty}
                  side={line.side}
                  typeLabel={line.typeLabel ?? "Limit"}
                  onPlaceTp={line.onPlaceTp}
                  onPlaceSl={line.onPlaceSl}
                  onCancel={line.onCancel}
                  onMouseDown={(e) => {
                    if (line.onDrag) startDrag(e, line.onDrag, line.onCommit);
                  }}
                />
              );
            }

            // Hover popup for the position's TP/SL: how far the level sits from
            // the entry, in percent. Derived from the EFFECTIVE price so it
            // tracks the value while the line is being dragged.
            let tooltip: string | undefined;
            if (line.isPosition && line.entryPrice && line.entryPrice > 0 &&
                (line.kind === "SL" || line.kind === "TP")) {
              const pct = ((effPrice - line.entryPrice) / line.entryPrice) * 100;
              const label = line.kind === "SL" ? "Stop Loss" : "Take Profit";
              tooltip = `${label} ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;
            }
            const renderLine =
              effPrice === line.price && !tooltip
                ? line
                : { ...line, price: effPrice, tooltip };
            return (
              <LineRow
                key={line.id ?? `line-${i}-${line.kind}`}
                line={renderLine}
                y={yPx}
                width={plotW}
                modifying={line.modifying ?? false}
                onMouseDown={(e) => {
                  if (line.onDrag) startDrag(e, line.onDrag, line.onCommit);
                }}
              />
            );
          });
        })()}
      </g>
    </svg>
    {ctxMenu && (
      <PositionContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        pos={ctxMenu.pos}
        field={ctxMenu.field}
        onModify={() => {
          openPositionEdit(symbol, ctxMenu.pos);
          setCtxMenu(null);
        }}
        onRemove={() => {
          ctxMenu.onRemove();
          setCtxMenu(null);
        }}
        onClose={() => setCtxMenu(null)}
      />
    )}
    </>
  );
}

/**
 * Small right-click menu on a position's SL/TP line: "Modify order…" opens
 * the typed editor in the trading panel (`PositionEditPanel` in
 * `OrderPanel.tsx`); "Remove" clears that level, same as the ×-chip.
 */
function PositionContextMenu({
  x, y, pos, field, onModify, onRemove, onClose,
}: {
  x: number;
  y: number;
  pos: Position;
  field: "TP" | "SL";
  onModify: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const isLong = pos.positionAmt > 0;
  const label = field === "TP" ? "Take Profit" : "Stop Loss";

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: x, top: y }}
      className="z-50 w-56 overflow-hidden rounded-md border border-tv-border bg-tv-panel shadow-xl"
    >
      <div className="border-b border-tv-border px-3 py-2 text-[10px] text-tv-text-muted">
        {isLong ? "Long" : "Short"} {Math.abs(pos.positionAmt)} @ {formatPrice(pos.entryPrice)} · {label}
      </div>
      <button
        onClick={onModify}
        className="block w-full px-3 py-2 text-left text-xs text-tv-text hover:bg-tv-panel-hover"
      >
        Modify order…
      </button>
      <button
        onClick={onRemove}
        className="block w-full px-3 py-2 text-left text-xs text-tv-red hover:bg-tv-panel-hover"
      >
        Remove
      </button>
    </div>,
    document.body,
  );
}
