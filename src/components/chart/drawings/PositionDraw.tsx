"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type {
  LongPositionDrawing,
  ShortPositionDrawing,
  Drawing,
  PositionStatKey,
} from "@/lib/drawings/types";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { DrawHandle } from "./DrawHandle";
import { useDragShape } from "./use-drag-shape";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { formatPrice } from "@/lib/format";
import { xToTime, timeframeToSeconds } from "@/lib/chart/coords";
import { useChartStore } from "@/lib/store/chart-store";
import { candlesRef as globalCandlesRef } from "@/lib/chart/candles-ref";
import { TV_PINE } from "@/lib/chart/theme";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import {
  positionQty,
  pnlAtLevel,
  balanceAfter,
  signedPct,
  signedTicks,
  rewardRiskRatio,
  openPnl,
  openPnlCurrency,
  deriveQuoteCurrency,
} from "@/lib/drawings/position-math";

type PositionDrawing = LongPositionDrawing | ShortPositionDrawing;

interface Props {
  drawing: PositionDrawing;
  xA: number;
  xB: number;
  yEntry: number;
  yStop: number;
  yTarget: number;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  container: HTMLElement | null;
}

function lineDash(style: 0 | 1 | 2 | undefined): string | undefined {
  return style === 1 ? "6 4" : style === 2 ? "2 4" : undefined;
}

function fmtMoney(n: number, quote: string): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quote}`;
}

function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function fmtSignedTicks(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n} ticks`;
}

/** Small flag/tag shown outside the zone (above or below). */
function OuterPill({
  cx, y, text, color, textColor, above,
}: {
  cx: number; y: number; text: string; color: string; textColor: string; above: boolean;
}) {
  const charW = 6.8;
  const padX = 10;
  const h = 19;
  const w = Math.max(text.length * charW + padX * 2, 60);
  const pillY = above ? y - h - 5 : y + 5;
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={cx - w / 2} y={pillY}
        width={w} height={h}
        fill={color} rx={3}
      />
      <text
        x={cx} y={pillY + h / 2 + 4}
        textAnchor="middle"
        fill={textColor} fontSize={11} fontWeight="700"
        fontFamily="var(--font-mono), monospace"
      >
        {text}
      </text>
    </g>
  );
}

export function PositionDraw({
  drawing,
  xA,
  xB,
  yEntry,
  yStop,
  yTarget,
  selected,
  onSelect,
  onEdit,
  chart,
  candleSeries,
  container,
}: Props) {
  const isLong = drawing.kind === "long";
  const side = isLong ? "long" : "short";

  const profitColor = drawing.targetColor ?? TV_PINE.green;
  const lossColor = drawing.stopColor ?? TV_PINE.red;
  const entryColor = drawing.color ?? TV_PINE.neutral;
  // TV's own long/short tool fills the zones with a fairly solid wash rather
  // than the near-transparent 0x20 (~12%) hex-alpha suffix this used before.
  const ZONE_OPACITY = 0.28;
  const textColor = drawing.textColor ?? TV_PINE.pillText;
  const textSize = drawing.textSize ?? 11;
  const showRMultiples = drawing.showRMultiples ?? false;

  const [hovered, setHovered] = useState(false);

  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<PositionDrawing | null>(null);

  // Instrument metadata for the ticks/qty stats. `tickSize` comes from the
  // symbol's exchange info (Binance/Bybit `exchangeInfo`, cached client-side
  // by `useSymbolInfo`). `pointValue` (contract multiplier) has no exchange
  // field — every symbol this app trades is spot or a USDT-margined linear
  // perp, where 1 contract = 1 unit of base asset, so it's a fixed 1 rather
  // than fetched. `quoteCurrency` is parsed off the symbol string itself
  // since `SymbolInfo` doesn't carry a quote asset.
  const symbolInfo = useSymbolInfo(drawing.symbol);
  const tickSize = symbolInfo.tickSize > 0 ? symbolInfo.tickSize : 0.01;
  const pointValue = 1;
  const quoteCurrency = deriveQuoteCurrency(drawing.symbol);

  // Live mark price for Open P&L, polled off the shared candles array (WS
  // ticks mutate it in place) rather than plumbed through props — same
  // 1s cadence as BarCountdown, and never persisted (derived-only).
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const last = globalCandlesRef.current[globalCandlesRef.current.length - 1];
      if (last) setMarkPrice(last.close);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  function snap() {
    const current = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
    if (current && (current.kind === "long" || current.kind === "short")) {
      snapshotRef.current = current;
    }
  }
  function commitEnd() {
    if (snapshotRef.current) void commit(drawing.id, snapshotRef.current);
  }

  /**
   * Left-edge handles. All three re-price their level vertically; only the
   * middle one (entry) also drags the left edge, so the box is resized from a
   * single grip while the stop/target handles stay purely vertical.
   */
  function makeYDrag(field: "entry" | "stop" | "target") {
    const resizesWidth = field === "entry";
    return (e: React.MouseEvent) => {
      if (!candleSeries || !container) return;
      if (resizesWidth && !chart) return;
      if (drawing.locked) return;
      e.preventDefault();
      e.stopPropagation();
      // Select on grab, not just on release — otherwise resizing straight
      // from a hover (without a separate prior click) never shows the
      // selected-only UI (R:R, inner stats) during the whole drag.
      onSelect();
      snap();
      const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
      function onMove(ev: MouseEvent) {
        const rect = container!.getBoundingClientRect();
        const patch: Record<string, number> = {};
        const p = candleSeries!.coordinateToPrice(ev.clientY - rect.top);
        if (p !== null) patch[field] = p as number;
        if (resizesWidth) {
          const t = xToTime(chart!, ev.clientX - rect.left, globalCandlesRef.current, intervalSec);
          if (t !== null) patch.timeA = t;
        }
        if (Object.keys(patch).length > 0) {
          updateLive(drawing.id, patch as Partial<Drawing>);
        }
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        commitEnd();
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = resizesWidth ? "move" : "ns-resize";
    };
  }

  function onRightHandleDrag(e: React.MouseEvent) {
    if (!chart || !container) return;
    if (drawing.locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    snap();
    const intervalSec = timeframeToSeconds(useChartStore.getState().timeframe);
    function onMove(ev: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const t = xToTime(chart!, x, globalCandlesRef.current, intervalSec);
      if (t === null) return;
      updateLive(drawing.id, { timeB: t } as Partial<Drawing>);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      commitEnd();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "ew-resize";
  }

  const dragShape = useDragShape<PositionDrawing>(
    chart,
    candleSeries,
    container,
    (orig, dt, dp) => ({
      entry: orig.entry + dp,
      stop: orig.stop + dp,
      target: orig.target + dp,
      timeA: orig.timeA + dt,
      timeB: orig.timeB + dt,
    }),
    () => {
      const c = useDrawingsStore.getState().drawings.find((d) => d.id === drawing.id);
      return c && (c.kind === "long" || c.kind === "short")
        ? (c as PositionDrawing)
        : null;
    },
    {
      onStart: snap,
      onMove: (patch) => updateLive(drawing.id, patch as Partial<Drawing>),
      onEnd: commitEnd,
    },
  );

  const left = Math.min(xA, xB);
  const right = Math.max(xA, xB);
  const zoneWidth = right - left;

  const profitY1 = Math.min(yEntry, yTarget);
  const profitY2 = Math.max(yEntry, yTarget);
  const lossY1 = Math.min(yEntry, yStop);
  const lossY2 = Math.max(yEntry, yStop);

  const risk = Math.abs(drawing.entry - drawing.stop);
  const rr = rewardRiskRatio(drawing.entry, drawing.stop, drawing.target);

  // Sign convention: profit % / ticks / $ are always positive, loss values
  // always negative, regardless of long/short (movement axis) — see
  // signedPct/signedTicks in position-math.ts.
  const targetPct = signedPct(drawing.entry, drawing.target, side);
  const stopPct = signedPct(drawing.entry, drawing.stop, side);
  const targetTicks = signedTicks(drawing.entry, drawing.target, tickSize, side);
  const stopTicks = signedTicks(drawing.entry, drawing.stop, tickSize, side);

  const qty = positionQty({
    entry: drawing.entry,
    stop: drawing.stop,
    accountSize: drawing.accountSize,
    risk: drawing.risk,
    riskIsPercent: drawing.riskIsPercent,
    leverage: drawing.leverage,
    pointValue,
    lotSize: drawing.lotSize ?? 1,
  });
  const hasMoneyStats = qty !== null && drawing.accountSize !== undefined;
  const qtyPrecision = drawing.qtyPrecision ?? 3;

  const targetPnl = hasMoneyStats ? pnlAtLevel(drawing.entry, drawing.target, qty!, side, pointValue) : 0;
  const stopPnl = hasMoneyStats ? pnlAtLevel(drawing.entry, drawing.stop, qty!, side, pointValue) : 0;
  const balanceAfterTP = hasMoneyStats ? balanceAfter(drawing.accountSize!, targetPnl) : 0;
  const balanceAfterSL = hasMoneyStats ? balanceAfter(drawing.accountSize!, stopPnl) : 0;

  const openPnlMove = markPrice !== null ? openPnl(drawing.entry, markPrice, side) : 0;
  const openPnlIsProfit = openPnlMove >= 0;
  const openPnlCurrencyVal =
    markPrice !== null && hasMoneyStats
      ? openPnlCurrency(drawing.entry, markPrice, qty!, side, pointValue)
      : null;

  // 1R/2R/3R… guide lines — legacy behavior, now opt-in (default off) so the
  // native TV look ships by default.
  const rLevels: { n: number; y: number }[] = [];
  if (showRMultiples && candleSeries && risk > 0) {
    const maxN = Math.min(Math.floor(rr - 1e-9), 10);
    for (let n = 1; n <= maxN; n++) {
      const price = drawing.entry + (isLong ? 1 : -1) * risk * n;
      const y = candleSeries.priceToCoordinate(price);
      if (y !== null) rLevels.push({ n, y: y as number });
    }
  }

  // Tag labels
  const targetTagText = `${formatPrice(drawing.target)}  ${fmtSignedPct(targetPct)}`;
  const stopTagText = `${formatPrice(drawing.stop)}  ${fmtSignedPct(stopPct)}`;

  const textX = left + zoneWidth / 2;
  const profitCenterY = (profitY1 + profitY2) / 2;
  const lossCenterY = (lossY1 + lossY2) / 2;
  const profitZoneH = profitY2 - profitY1;
  const lossZoneH = lossY2 - lossY1;

  const topY = Math.min(profitY1, lossY1);
  const bottomY = Math.max(profitY2, lossY2);
  const topTagColor = isLong ? profitColor : lossColor;
  const topTagText = isLong ? targetTagText : stopTagText;
  const bottomTagColor = isLong ? lossColor : profitColor;
  const bottomTagText = isLong ? stopTagText : targetTagText;

  const handleR = 8;
  const pillH = 23;
  const boundTop = topY - pillH - handleR;
  const boundBottom = bottomY + pillH + handleR;
  const boundLeft = left - handleR;

  function statVisible(key: PositionStatKey): boolean {
    return drawing.statsOverrides?.[key] !== false;
  }

  const alwaysShowStats = drawing.alwaysShowStats ?? false;
  const showStats = alwaysShowStats || hovered || selected;
  const compact = drawing.compactStats ?? false;

  function onZoneMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect();
    // Drag immediately — no need to click twice
    dragShape(e);
  }

  // ── Stats block rows ────────────────────────────────────────────────────
  // Entry row segments carry their own color (Open P&L is movement-colored
  // green/red; qty and R:R stay the entry line's neutral color) so they
  // render as separate <tspan>s inside one centered <text>.
  const entryRowSegments: { text: string; color: string }[] = [];
  if (statVisible("openPnl") && markPrice !== null) {
    const txt =
      openPnlCurrencyVal !== null
        ? fmtMoney(openPnlCurrencyVal, quoteCurrency)
        : fmtSignedPct(openPnlMove !== 0 ? (openPnlMove / drawing.entry) * 100 : 0);
    entryRowSegments.push({ text: `P&L ${txt}`, color: openPnlIsProfit ? TV_PINE.green : TV_PINE.red });
  }
  if (statVisible("qty") && hasMoneyStats) {
    entryRowSegments.push({ text: `Qty ${qty!.toFixed(qtyPrecision)}`, color: entryColor });
  }
  if (statVisible("rr")) {
    entryRowSegments.push({ text: `R:R ${rr.toFixed(2)}`, color: entryColor });
  }

  const targetRowParts: string[] = [];
  if (statVisible("profitLoss") && hasMoneyStats) targetRowParts.push(fmtMoney(targetPnl, quoteCurrency));
  if (statVisible("pct")) targetRowParts.push(fmtSignedPct(targetPct));
  if (statVisible("ticks")) targetRowParts.push(fmtSignedTicks(targetTicks));
  if (statVisible("balance") && hasMoneyStats) {
    targetRowParts.push(`Bal ${balanceAfterTP.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  }

  const stopRowParts: string[] = [];
  if (statVisible("profitLoss") && hasMoneyStats) stopRowParts.push(fmtMoney(stopPnl, quoteCurrency));
  if (statVisible("pct")) stopRowParts.push(fmtSignedPct(stopPct));
  if (statVisible("ticks")) stopRowParts.push(fmtSignedTicks(stopTicks));
  if (statVisible("balance") && hasMoneyStats) {
    stopRowParts.push(`Bal ${balanceAfterSL.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  }

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Bounding rect — hover + drag target for the whole drawing */}
      <rect
        x={boundLeft} y={boundTop}
        width={zoneWidth + handleR * 2} height={boundBottom - boundTop}
        fill="transparent"
        className="drawing-hit"
        style={{ pointerEvents: "all", cursor: selected ? "move" : "pointer" }}
        onMouseDown={onZoneMouseDown}
        onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}
      />

      {/* Colored zones — a solid-enough wash via a real alpha channel
          (fillOpacity), not a truncated hex-alpha suffix. */}
      <rect x={left} y={profitY1} width={zoneWidth} height={profitZoneH} fill={profitColor} fillOpacity={ZONE_OPACITY} style={{ pointerEvents: "none" }} />
      <rect x={left} y={lossY1} width={zoneWidth} height={lossZoneH} fill={lossColor} fillOpacity={ZONE_OPACITY} style={{ pointerEvents: "none" }} />

      {/* 1R/2R/3R… guide lines — opt-in, off by default */}
      {rLevels.map(({ n, y }) => (
        <g key={`r${n}`} style={{ pointerEvents: "none" }}>
          <line
            x1={left} x2={right} y1={y} y2={y}
            stroke={profitColor} strokeWidth={1} strokeDasharray="2,3" opacity={0.5}
          />
          <text
            x={left + 4} y={y - 3}
            fill={profitColor} fontSize={11} opacity={0.65}
            fontFamily="var(--font-mono), monospace"
          >
            {n}R
          </text>
        </g>
      ))}

      {/* Target line */}
      <line
        x1={left} x2={right} y1={yTarget} y2={yTarget}
        stroke={profitColor} strokeWidth={drawing.targetLineWidth ?? 1.5}
        strokeDasharray={lineDash(drawing.targetLineStyle)}
        style={{ pointerEvents: "none" }}
      />
      {/* Stop line */}
      <line
        x1={left} x2={right} y1={yStop} y2={yStop}
        stroke={lossColor} strokeWidth={drawing.stopLineWidth ?? 1.5}
        strokeDasharray={lineDash(drawing.stopLineStyle)}
        style={{ pointerEvents: "none" }}
      />
      {/* Entry line */}
      <line
        x1={left} x2={right} y1={yEntry} y2={yEntry}
        stroke={entryColor} strokeWidth={drawing.lineWidth ?? 1.5}
        strokeDasharray={lineDash(drawing.lineStyle)}
        style={{ pointerEvents: "none" }}
      />

      {/* Outer tags — above top zone, below bottom zone — visible on hover or selected */}
      {(hovered || selected) && (
        <>
          <OuterPill
            cx={left + zoneWidth / 2} y={topY}
            text={topTagText} color={topTagColor} textColor={textColor} above
          />
          <OuterPill
            cx={left + zoneWidth / 2} y={bottomY}
            text={bottomTagText} color={bottomTagColor} textColor={textColor} above={false}
          />
        </>
      )}

      {/* Stats block */}
      {showStats && (
        <g style={{ pointerEvents: "none" }} fontFamily="var(--font-mono), monospace">
          {compact ? (
            <>
              {entryRowSegments.length > 0 && (
                <EntryRowText x={textX} y={yEntry - 4} fontSize={textSize} segments={entryRowSegments} gap="  " />
              )}
              {targetRowParts.length > 0 && profitZoneH > 14 && (
                <text x={textX} y={profitCenterY + 4} textAnchor="middle" fill={profitColor} fontSize={textSize} fontWeight="700">
                  {targetRowParts.join("  ")}
                </text>
              )}
              {stopRowParts.length > 0 && lossZoneH > 14 && (
                <text x={textX} y={lossCenterY + 4} textAnchor="middle" fill={lossColor} fontSize={textSize} fontWeight="700">
                  {stopRowParts.join("  ")}
                </text>
              )}
            </>
          ) : (
            <>
              {entryRowSegments.length > 0 && (
                <EntryRowText x={textX} y={yEntry - 4} fontSize={textSize} segments={entryRowSegments} gap="   " />
              )}
              {targetRowParts.length > 0 && profitZoneH > 32 && (
                <text x={textX} y={profitCenterY + (profitZoneH > 56 ? -2 : 4)} textAnchor="middle" fill={profitColor} fontSize={textSize} fontWeight="700" opacity={0.9}>
                  {targetRowParts.join("   ")}
                </text>
              )}
              {stopRowParts.length > 0 && lossZoneH > 32 && (
                <text x={textX} y={lossCenterY + (lossZoneH > 56 ? -2 : 4)} textAnchor="middle" fill={lossColor} fontSize={textSize} fontWeight="700" opacity={0.9}>
                  {stopRowParts.join("   ")}
                </text>
              )}
            </>
          )}
        </g>
      )}

      {/* Handles — always mounted (never unmounted/remounted on hover) so a
          fast hover-then-grab never races the state update that would
          otherwise need to land first for the handle to exist to click on.
          Only their visibility is hover/selection-gated. */}
      <g style={{ opacity: hovered || selected ? 1 : 0, transition: "opacity 80ms" }}>
        <DrawHandle x={left} y={yEntry} color={entryColor} selected={selected} onMouseDown={makeYDrag("entry")} />
        <DrawHandle x={left} y={yStop} color={lossColor} selected={selected} shape="square" onMouseDown={makeYDrag("stop")} />
        <DrawHandle x={left} y={yTarget} color={profitColor} selected={selected} shape="square" onMouseDown={makeYDrag("target")} />
        <DrawHandle
          x={xB}
          y={(Math.min(profitY1, lossY1) + Math.max(profitY2, lossY2)) / 2}
          color={entryColor}
          selected={selected}
          shape="square"
          onMouseDown={onRightHandleDrag}
        />
      </g>
    </g>
  );
}

/** Entry stats row: each segment keeps its own color (Open P&L is
 *  movement-colored; qty/R:R stay neutral) inside one centered text run. */
function EntryRowText({
  x, y, fontSize, segments, gap,
}: {
  x: number; y: number; fontSize: number; segments: { text: string; color: string }[]; gap: string;
}) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={fontSize} fontWeight="700">
      {segments.map((s, i) => (
        <tspan key={i} fill={s.color}>
          {i > 0 ? gap : ""}
          {s.text}
        </tspan>
      ))}
    </text>
  );
}
