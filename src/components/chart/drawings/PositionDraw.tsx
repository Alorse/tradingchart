"use client";

import { useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type {
  LongPositionDrawing,
  ShortPositionDrawing,
  Drawing,
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

/** Pill shown outside the zone (above or below). */
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
        fill={color} rx={6}
        opacity={0.92}
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

  const profitColor = drawing.targetColor ?? TV_PINE.green;
  const lossColor = drawing.stopColor ?? TV_PINE.red;
  const profitFill = `${profitColor}20`;
  const lossFill = `${lossColor}20`;
  const entryColor = drawing.color ?? TV_PINE.neutral;

  const [hovered, setHovered] = useState(false);

  const { updateLive, commit } = useDrawings();
  const snapshotRef = useRef<PositionDrawing | null>(null);

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
  const reward = Math.abs(drawing.target - drawing.entry);
  const rr = risk === 0 ? 0 : reward / risk;
  const pctProfit = drawing.entry === 0 ? 0 : (reward / Math.abs(drawing.entry)) * 100;
  const pctLoss = drawing.entry === 0 ? 0 : (risk / Math.abs(drawing.entry)) * 100;

  // 1R/2R/3R… guide lines inside the profit zone — R is the risk distance
  // (entry to stop), so these mark whole risk-multiples of reward, letting
  // you see at a glance when price reaches 1R to consider taking partials.
  // Stops strictly before the target's own multiple so it doesn't double up
  // with the target line when the target sits exactly on a whole R.
  const rLevels: { n: number; y: number }[] = [];
  if (candleSeries && risk > 0) {
    const maxN = Math.min(Math.floor(rr - 1e-9), 10);
    for (let n = 1; n <= maxN; n++) {
      const price = drawing.entry + (isLong ? 1 : -1) * risk * n;
      const y = candleSeries.priceToCoordinate(price);
      if (y !== null) rLevels.push({ n, y: y as number });
    }
  }

  // Pill labels
  const targetPillText = `${formatPrice(drawing.target)}  ${isLong ? "+" : "-"}${pctProfit.toFixed(2)}%`;
  const stopPillText = `${formatPrice(drawing.stop)}  ${isLong ? "-" : "+"}${pctLoss.toFixed(2)}%`;

  // Zone centers for inner text
  const profitCenterY = (profitY1 + profitY2) / 2;
  const lossCenterY = (lossY1 + lossY2) / 2;
  const textX = left + zoneWidth / 2;
  const profitZoneH = profitY2 - profitY1;
  const lossZoneH = lossY2 - lossY1;

  // Which is top / bottom
  const topY = Math.min(profitY1, lossY1);
  const bottomY = Math.max(profitY2, lossY2);
  const topPillColor = isLong ? profitColor : lossColor;
  const topPillText = isLong ? targetPillText : stopPillText;
  const bottomPillColor = isLong ? lossColor : profitColor;
  const bottomPillText = isLong ? stopPillText : targetPillText;

  // Bounding hover rect
  const handleR = 8;
  const pillH = 23;
  const boundTop = topY - pillH - handleR;
  const boundBottom = bottomY + pillH + handleR;
  const boundLeft = left - handleR;

  function onZoneMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect();
    // Drag immediately — no need to click twice
    dragShape(e);
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

      {/* Colored zones */}
      <rect x={left} y={profitY1} width={zoneWidth} height={profitZoneH} fill={profitFill} style={{ pointerEvents: "none" }} />
      <rect x={left} y={lossY1} width={zoneWidth} height={lossZoneH} fill={lossFill} style={{ pointerEvents: "none" }} />

      {/* 1R/2R/3R… guide lines */}
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

      {/* Entry line */}
      <line
        x1={left} x2={right} y1={yEntry} y2={yEntry}
        stroke={entryColor} strokeWidth={drawing.lineWidth ?? 1.5}
        style={{ pointerEvents: "none" }}
      />

      {/* Outer pills — above top zone, below bottom zone — visible on hover or selected */}
      {(hovered || selected) && (
        <>
          <OuterPill
            cx={left + zoneWidth / 2} y={topY}
            text={topPillText} color={topPillColor} textColor={drawing.textColor ?? TV_PINE.pillText} above
          />
          <OuterPill
            cx={left + zoneWidth / 2} y={bottomY}
            text={bottomPillText} color={bottomPillColor} textColor={drawing.textColor ?? TV_PINE.pillText} above={false}
          />
        </>
      )}

      {/* Inner stats — only when selected and zone is tall enough */}
      {selected && profitZoneH > 32 && (
        <g style={{ pointerEvents: "none" }}>
          <text
            x={textX} y={profitCenterY + (profitZoneH > 56 ? -6 : 4)}
            textAnchor="middle" fill={profitColor}
            fontSize={13} fontWeight="700"
            fontFamily="var(--font-mono), monospace"
            opacity={0.85}
          >
            {isLong ? "+" : "-"}{pctProfit.toFixed(2)}%
          </text>
          {profitZoneH > 56 && (
            <text
              x={textX} y={profitCenterY + 12}
              textAnchor="middle" fill={profitColor}
              fontSize={11} opacity={0.5}
              fontFamily="var(--font-mono), monospace"
            >
              RR {rr.toFixed(2)}
            </text>
          )}
        </g>
      )}
      {selected && lossZoneH > 32 && (
        <g style={{ pointerEvents: "none" }}>
          <text
            x={textX} y={lossCenterY + 4}
            textAnchor="middle" fill={lossColor}
            fontSize={13} fontWeight="700"
            fontFamily="var(--font-mono), monospace"
            opacity={0.85}
          >
            {isLong ? "-" : "+"}{pctLoss.toFixed(2)}%
          </text>
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
