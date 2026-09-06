"use client";
import { TV_PINE } from "@/lib/chart/theme";

interface Props {
  x: number;
  y: number;
  color: string;
  selected?: boolean;
  /** "square" for handles with resize-only behavior; default "circle". */
  shape?: "circle" | "square";
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}

/** Small circle or square that the user can grab and drag. */
export function DrawHandle({ x, y, color, selected, shape = "circle", onPointerDown }: Props) {
  const commonProps = {
    fill: TV_PINE.handleFill,
    stroke: TV_PINE.handleStroke,
    strokeWidth: 1.5,
    className: "drawing-hit",
    style: { pointerEvents: "all" as const, cursor: "grab", touchAction: "none" as const },
    onPointerDown,
  };
  if (shape === "square") {
    const size = 9;
    return <rect x={x - size / 2} y={y - size / 2} width={size} height={size} {...commonProps} />;
  }
  return <circle cx={x} cy={y} r={5} {...commonProps} />;
}
