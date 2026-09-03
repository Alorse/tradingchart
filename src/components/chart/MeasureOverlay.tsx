"use client";

import { formatPrice, formatVolume } from "@/lib/format";

interface Props {
  aX: number;
  aY: number;
  bX: number;
  bY: number;
  priceDiff: number;
  pctChange: number;
  bars: number;
  volume: number;
  durationText: string;
  isUp: boolean;
  isPreview: boolean;
}

const UP_STROKE = "#26a69a";
const UP_FILL = "rgba(38, 166, 154, 0.18)";
const DOWN_STROKE = "#ef5350";
const DOWN_FILL = "rgba(239, 83, 80, 0.18)";

export function MeasureOverlay({
  aX,
  aY,
  bX,
  bY,
  priceDiff,
  pctChange,
  bars,
  volume,
  durationText,
  isUp,
  isPreview,
}: Props) {
  const stroke = isUp ? UP_STROKE : DOWN_STROKE;
  const fill = isUp ? UP_FILL : DOWN_FILL;

  const left = Math.min(aX, bX);
  const right = Math.max(aX, bX);
  const top = Math.min(aY, bY);
  const bottom = Math.max(aY, bY);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const centerX = (aX + bX) / 2;

  const markerId = `measure-arrow-${isUp ? "up" : "down"}`;

  const labelStyle: React.CSSProperties = {
    left: centerX,
    top: isUp ? top - 60 : bottom + 8,
  };

  const sign = priceDiff >= 0 ? "+" : "";
  const pctSign = pctChange >= 0 ? "+" : "";

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-20 h-full w-full"
        style={{ overflow: "visible" }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>

        {/* Range rectangle */}
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
          strokeDasharray={isPreview ? "4,3" : undefined}
        />

        {/* Horizontal reference line at price A */}
        <line
          x1={left}
          x2={right}
          y1={aY}
          y2={aY}
          stroke={stroke}
          strokeWidth={1}
          strokeDasharray="2,3"
          opacity={0.7}
        />

        {/* Vertical arrow in the center indicating direction */}
        <line
          x1={centerX}
          x2={centerX}
          y1={aY}
          y2={bY}
          stroke={stroke}
          strokeWidth={1.5}
          markerEnd={`url(#${markerId})`}
        />
      </svg>

      <div
        className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded border px-2 py-1 text-center text-[11px] font-medium leading-tight tabular-nums shadow-md"
        style={{
          ...labelStyle,
          backgroundColor: stroke,
          borderColor: stroke,
          color: "#ffffff",
        }}
      >
        <div>
          {sign}
          {formatPrice(priceDiff)} ({pctSign}
          {pctChange.toFixed(2)}%)
        </div>
        <div className="opacity-90">
          {bars} bars · {durationText}
        </div>
        <div className="opacity-90">Vol {formatVolume(volume)}</div>
      </div>
    </>
  );
}
