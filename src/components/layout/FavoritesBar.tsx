"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useChartStore, type DrawingTool } from "@/lib/store/chart-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ALL_TOOLS, type ToolDef } from "./drawing-tools";

/**
 * Floating, draggable favorites toolbar (TradingView style). Renders over the
 * chart. Drag the handle to move the whole bar (position persists); drag a tool
 * icon to reorder; right-click a tool to remove it from favorites.
 */
export function FavoritesBar() {
  const favoriteTools = useChartStore((s) => s.favoriteTools);
  const tool = useChartStore((s) => s.tool);
  const setTool = useChartStore((s) => s.setTool);
  const toggleFavoriteTool = useChartStore((s) => s.toggleFavoriteTool);
  const setFavoriteTools = useChartStore((s) => s.setFavoriteTools);
  const savedPos = useChartStore((s) => s.favoritesBarPos);
  const setSavedPos = useChartStore((s) => s.setFavoritesBarPos);

  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const moveRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const livePosRef = useRef<{ x: number; y: number } | null>(null);

  // Drag-to-reorder state.
  const draggedKey = useRef<DrawingTool | null>(null);
  const [dragOverKey, setDragOverKey] = useState<DrawingTool | null>(null);

  const favs = favoriteTools
    .filter((k) => k !== "cursor")
    .map((k) => ALL_TOOLS[k])
    .filter((t): t is ToolDef => !!t);

  function clampToParent(x: number, y: number) {
    const parent = barRef.current?.offsetParent as HTMLElement | null;
    const bw = barRef.current?.offsetWidth ?? 0;
    const bh = barRef.current?.offsetHeight ?? 0;
    const pw = parent?.clientWidth ?? Infinity;
    const ph = parent?.clientHeight ?? Infinity;
    return { x: Math.max(0, Math.min(x, pw - bw)), y: Math.max(0, Math.min(y, ph - bh)) };
  }

  // Place on first appearance: restore the saved position (clamped) or center it.
  useLayoutEffect(() => {
    if (pos || !barRef.current || favs.length === 0) return;
    const parent = barRef.current.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? 0;
    const bw = barRef.current.offsetWidth;
    const target = savedPos ?? { x: Math.max(8, Math.round((pw - bw) / 2)), y: 8 };
    const clamped = clampToParent(target.x, target.y);
    setPos(clamped);
    if (!savedPos) setSavedPos(clamped);
  }, [pos, favs.length, savedPos, setSavedPos]);

  if (favs.length === 0) return null;

  // ── Move the whole bar (handle) ────────────────────────────────────────────
  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    moveRef.current = { ox: e.clientX, oy: e.clientY, px: pos?.x ?? 0, py: pos?.y ?? 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!moveRef.current) return;
    const clamped = clampToParent(
      moveRef.current.px + e.clientX - moveRef.current.ox,
      moveRef.current.py + e.clientY - moveRef.current.oy,
    );
    livePosRef.current = clamped;
    setPos(clamped);
  }
  function endMove() {
    moveRef.current = null;
    if (livePosRef.current) setSavedPos(livePosRef.current); // persist
  }

  // ── Reorder tools (HTML5 drag & drop) ──────────────────────────────────────
  function handleDrop(targetKey: DrawingTool) {
    const dragged = draggedKey.current;
    draggedKey.current = null;
    setDragOverKey(null);
    if (!dragged || dragged === targetKey) return;
    const arr = [...favoriteTools];
    const from = arr.indexOf(dragged);
    if (from < 0) return;
    arr.splice(from, 1);
    const to = arr.indexOf(targetKey);
    if (to < 0) return;
    arr.splice(to, 0, dragged);
    setFavoriteTools(arr);
  }

  return (
    <div
      ref={barRef}
      className="pointer-events-auto absolute z-30 flex items-center gap-0.5 rounded-md border border-tv-border bg-tv-panel/95 p-0.5 shadow-lg backdrop-blur"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? 8, userSelect: "none" }}
    >
      <div
        className="flex cursor-grab items-center px-0.5 text-tv-text-muted hover:text-tv-text active:cursor-grabbing"
        onPointerDown={startMove}
        onPointerMove={onMove}
        onPointerUp={endMove}
        title="Drag to move"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      {favs.map((t) => {
        const Icon = t.icon;
        const active = tool === t.key;
        return (
          <Tooltip key={t.key}>
            <TooltipTrigger
              draggable
              onDragStart={(e) => {
                draggedKey.current = t.key;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", t.key);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggedKey.current && draggedKey.current !== t.key) setDragOverKey(t.key);
              }}
              onDrop={() => handleDrop(t.key)}
              onDragEnd={() => {
                draggedKey.current = null;
                setDragOverKey(null);
              }}
              onClick={() => setTool(t.key)}
              onContextMenu={(e) => {
                e.preventDefault();
                toggleFavoriteTool(t.key);
              }}
              aria-label={t.label}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover",
                active ? "bg-tv-blue/15 text-tv-blue-text" : "text-tv-text-muted hover:text-tv-text",
                dragOverKey === t.key && "ring-1 ring-tv-blue",
              )}
            >
              <Icon className="h-6 w-6" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="font-medium">{t.label}</div>
              <div className="mt-0.5 text-[10px] text-tv-text-muted">Drag to reorder · right-click to remove</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
