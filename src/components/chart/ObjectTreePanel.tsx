"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarRange,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  GitFork,
  GripVertical,
  Highlighter,
  Layers3,
  Lock,
  MessageSquare,
  Minus,
  MoreVertical,
  MoveRight,
  Pencil,
  Percent,
  RectangleHorizontal,
  Ruler,
  Slash,
  Spline,
  Trash2,
  TrendingUp,
  Type,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChartStore } from "@/lib/store/chart-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import type { Drawing, DrawingKind } from "@/lib/drawings/types";
import { cn } from "@/lib/utils";

const KIND_META: Record<DrawingKind, { label: string; icon: LucideIcon }> = {
  hline: { label: "Horizontal line", icon: Minus },
  vline: { label: "Vertical line", icon: GripVertical },
  trendline: { label: "Trend line", icon: TrendingUp },
  ray: { label: "Ray", icon: Slash },
  hray: { label: "Horizontal ray", icon: MoveRight },
  "parallel-channel": { label: "Parallel channel", icon: Layers3 },
  "fib-retracement": { label: "Fib retracement", icon: Percent },
  "price-range": { label: "Price range", icon: RectangleHorizontal },
  "date-range": { label: "Date range", icon: CalendarRange },
  long: { label: "Long position", icon: TrendingUp },
  short: { label: "Short position", icon: TrendingUp },
  brush: { label: "Brush", icon: Pencil },
  highlighter: { label: "Highlighter", icon: Highlighter },
  rectangle: { label: "Rectangle", icon: RectangleHorizontal },
  arrow: { label: "Arrow", icon: ArrowUpRight },
  text: { label: "Text", icon: Type },
  "fib-extension": { label: "Fib extension", icon: Percent },
  pitchfork: { label: "Pitchfork", icon: GitFork },
  callout: { label: "Callout", icon: MessageSquare },
  xabcd: { label: "XABCD pattern", icon: Spline },
};

function metaFor(kind: DrawingKind) {
  return KIND_META[kind] ?? { label: kind, icon: Ruler };
}

export function ObjectTreePanel() {
  const symbol = useChartStore((s) => s.symbol);
  const drawings = useDrawingsStore((s) => s.drawings);
  const selectedId = useDrawingsStore((s) => s.selectedId);
  const setSelected = useDrawingsStore((s) => s.setSelected);
  const { update, remove, reorder, setOrder } = useDrawings();

  // Front-most (last in the array) at the top of the list, TradingView-style.
  const items = drawings.filter((d) => d.symbol === symbol).slice().reverse();

  const draggedId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Multi-select (Ctrl/Cmd toggles one, Shift extends from the last click)
  // for batch hide/lock/delete — separate from `selectedId`, which drives
  // the single chart selection (floating toolbar, handles, etc).
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  useEffect(() => {
    if (multiSelected.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMultiSelected(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiSelected.size]);

  // Switching symbols invalidates any selection (the ids no longer belong to
  // `items`, which is scoped to the current symbol). Reset during render —
  // React's documented pattern for "state that depends on a changed prop" —
  // rather than an effect, so it can't cause an extra render pass.
  const [selectionSymbol, setSelectionSymbol] = useState(symbol);
  if (selectionSymbol !== symbol) {
    setSelectionSymbol(symbol);
    setMultiSelected(new Set());
  }

  function toggleHidden(d: Drawing) {
    void update(d.id, { hidden: !d.hidden });
  }
  function toggleLocked(d: Drawing) {
    void update(d.id, { locked: !d.locked });
  }

  function handleRowClick(e: React.MouseEvent, d: Drawing) {
    if (e.shiftKey && lastClickedRef.current) {
      const ids = items.map((i) => i.id);
      const a = ids.indexOf(lastClickedRef.current);
      const b = ids.indexOf(d.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setMultiSelected((prev) => new Set([...prev, ...ids.slice(lo, hi + 1)]));
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(d.id)) next.delete(d.id);
        else next.add(d.id);
        return next;
      });
      lastClickedRef.current = d.id;
      return;
    }
    if (multiSelected.size > 0) {
      setMultiSelected(new Set());
      return;
    }
    setSelected(d.id === selectedId ? null : d.id);
    lastClickedRef.current = d.id;
  }

  function batchHide(hide: boolean) {
    for (const id of multiSelected) void update(id, { hidden: hide });
  }
  function batchLock(lock: boolean) {
    for (const id of multiSelected) void update(id, { locked: lock });
  }
  function batchDelete() {
    for (const id of multiSelected) void remove(id);
    setMultiSelected(new Set());
  }

  function handleDrop(targetId: string) {
    const fromId = draggedId.current;
    draggedId.current = null;
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    const from = items.findIndex((d) => d.id === fromId);
    const to = items.findIndex((d) => d.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // items is displayed front-most-first; setOrder expects the underlying
    // back-to-front array order, same as `drawings` itself.
    void setOrder(symbol, next.map((d) => d.id).reverse());
  }

  return (
    <div className="flex h-full flex-col text-tv-text">
      <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Objects
        </span>
        <span className="text-[11px] text-tv-text-muted">{items.length}</span>
      </div>

      {multiSelected.size > 0 && (
        <div className="flex items-center gap-1.5 border-b border-tv-border bg-tv-blue/10 px-2 py-1.5">
          <span className="flex-1 text-[11px] font-medium text-tv-text">
            {multiSelected.size} selected
          </span>
          <button
            onClick={() => batchHide(true)}
            title="Hide selected"
            className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => batchHide(false)}
            title="Show selected"
            className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => batchLock(true)}
            title="Lock selected"
            className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Lock className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => batchLock(false)}
            title="Unlock selected"
            className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Unlock className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={batchDelete}
            title="Delete selected"
            className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-red/15 hover:text-tv-red"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setMultiSelected(new Set())}
            title="Clear selection"
            className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-tv-text-muted">
          No drawings on {symbol}. Pick a tool from the left toolbar to start.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {items.map((d, i) => {
            const { label, icon: Icon } = metaFor(d.kind);
            const isSelected = d.id === selectedId;
            const isMultiSelected = multiSelected.has(d.id);
            const isFirst = i === 0; // front-most
            const isLast = i === items.length - 1; // back-most
            return (
              <div
                key={d.id}
                draggable
                onDragStart={() => { draggedId.current = d.id; }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedId.current !== d.id) setDragOverId(d.id);
                }}
                onDrop={() => handleDrop(d.id)}
                onDragEnd={() => { draggedId.current = null; setDragOverId(null); }}
                onClick={(e) => handleRowClick(e, d)}
                className={cn(
                  "group flex cursor-grab items-center gap-1.5 px-2 py-1.5 text-[12px] transition-colors active:cursor-grabbing",
                  isSelected && !isMultiSelected ? "bg-tv-blue/15" : "hover:bg-tv-panel-hover",
                  isMultiSelected && "bg-tv-blue/25",
                  dragOverId === d.id && "border-t-2 border-t-tv-blue",
                )}
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
                  style={{ color: d.color ?? "var(--color-tv-text-muted)" }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className={cn("min-w-0 flex-1 truncate", d.hidden && "text-tv-text-disabled")}>
                  {label}
                </span>

                {/* Reorder — behind one menu rather than four buttons per row */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Reorder"
                    title="Reorder"
                    className="flex h-6 w-6 items-center justify-center rounded text-tv-text-dim opacity-0 hover:bg-tv-panel-hover hover:text-tv-text group-hover:opacity-100 data-popup-open:opacity-100"
                  >
                    <MoreVertical className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40 bg-tv-panel">
                    <DropdownMenuItem
                      disabled={isFirst}
                      onClick={() => void reorder(d.id, "front")}
                    >
                      <ChevronsUp className="size-4" />
                      Bring to front
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isFirst}
                      onClick={() => void reorder(d.id, "forward")}
                    >
                      <ArrowUp className="size-4" />
                      Bring forward
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isLast}
                      onClick={() => void reorder(d.id, "backward")}
                    >
                      <ArrowDown className="size-4" />
                      Send backward
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isLast}
                      onClick={() => void reorder(d.id, "back")}
                    >
                      <ChevronsDown className="size-4" />
                      Send to back
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Hide / lock / delete */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHidden(d);
                  }}
                  aria-label={d.hidden ? "Show" : "Hide"}
                  title={d.hidden ? "Show" : "Hide"}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded hover:bg-tv-panel-hover hover:text-tv-text",
                    d.hidden ? "text-tv-text-muted opacity-100" : "text-tv-text-dim opacity-0 group-hover:opacity-100",
                  )}
                >
                  {d.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLocked(d);
                  }}
                  aria-label={d.locked ? "Unlock" : "Lock"}
                  title={d.locked ? "Unlock" : "Lock"}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded hover:bg-tv-panel-hover hover:text-tv-text",
                    d.locked ? "text-tv-yellow opacity-100" : "text-tv-text-dim opacity-0 group-hover:opacity-100",
                  )}
                >
                  {d.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(d.id);
                  }}
                  aria-label="Delete"
                  title="Delete"
                  className="flex h-6 w-6 items-center justify-center rounded text-tv-text-dim opacity-0 hover:bg-tv-panel-hover hover:text-tv-red group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
