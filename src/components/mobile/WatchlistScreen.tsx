"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderInput,
  GripVertical,
  ListPlus,
  ListX,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Type,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { fetchTickers24h, cleanSym } from "@/lib/binance/rest";
import { fetchBybitTickers24h } from "@/lib/bybit/public";
import { sortWatchlistItems, cycleSort } from "@/lib/watchlist/sort";
import { getBinanceWS } from "@/lib/binance/ws";
import { getBybitWS } from "@/lib/bybit/ws";
import { resolveSource } from "@/lib/symbols/source";
import { stripExchangePrefix } from "@/lib/symbols/prefix";
import { useChartStore, type WatchlistItem } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { useTradingStore } from "@/lib/store/trading-store";
import type { Position } from "@/lib/binance/trading-types";
import { formatPrice, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBatchedTicks } from "@/hooks/useBatchedTicks";
import { CoinIcon, getBaseAsset } from "@/components/watchlist/CoinIcon";
import { FlagPennant } from "@/components/watchlist/FlagPennant";
import { FLAG_COLORS } from "@/lib/watchlist/flags";
import { MobileSheet } from "./MobileSheet";

interface Row {
  symbol: string;
  price: number;
  pct: number;
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/**
 * Mobile watchlist — feature parity with the desktop <Watchlist /> (same
 * store actions), gestures adapted for touch:
 *  - long-press a row → enter multi-select (desktop uses Ctrl/Shift-click)
 *  - a "⋮" per row opens flag color / add label above / move to list
 *    (desktop puts these behind right-click)
 *  - a dedicated grip handle drives pointer-based drag-to-reorder (desktop
 *    uses native HTML5 drag, which touch browsers don't fire reliably)
 *  - watchlist management (switch/create/rename/duplicate/delete) lives in
 *    a full sheet instead of a dropdown
 */
export function WatchlistScreen() {
  const watchlists = useChartStore((s) => s.watchlists);
  const activeWatchlistId = useChartStore((s) => s.activeWatchlistId);
  const setActiveWatchlist = useChartStore((s) => s.setActiveWatchlist);
  const createWatchlist = useChartStore((s) => s.createWatchlist);
  const renameWatchlist = useChartStore((s) => s.renameWatchlist);
  const deleteWatchlist = useChartStore((s) => s.deleteWatchlist);
  const duplicateWatchlist = useChartStore((s) => s.duplicateWatchlist);
  const clearWatchlistItems = useChartStore((s) => s.clearWatchlistItems);
  const addLabelToWatchlist = useChartStore((s) => s.addLabelToWatchlist);
  const removeWatchlistItem = useChartStore((s) => s.removeWatchlistItem);
  const removeWatchlistItems = useChartStore((s) => s.removeWatchlistItems);
  const setWatchlistItemFlag = useChartStore((s) => s.setWatchlistItemFlag);
  const setWatchlistItemsFlag = useChartStore((s) => s.setWatchlistItemsFlag);
  const moveWatchlistItemToList = useChartStore((s) => s.moveWatchlistItemToList);
  const reorderWatchlistItems = useChartStore((s) => s.reorderWatchlistItems);
  const renameWatchlistItem = useChartStore((s) => s.renameWatchlistItem);
  const sort = useChartStore((s) => s.watchlistSort);
  const setWatchlistSort = useChartStore((s) => s.setWatchlistSort);
  const collapsedLabels = useChartStore((s) => s.watchlistCollapsedLabels);
  const toggleWatchlistLabelCollapsed = useChartStore((s) => s.toggleWatchlistLabelCollapsed);
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const openSymbolDialog = useChartStore((s) => s.setSymbolDialogOpen);
  const setSymbolDialogInsertAfterId = useChartStore((s) => s.setSymbolDialogInsertAfterId);
  const setTab = useMobileStore((s) => s.setTab);
  const allPositions = useTradingStore((s) => s.allPositions);
  const tradingExchange = useTradingStore((s) => s.exchange);

  const active = watchlists.find((w) => w.id === activeWatchlistId) ?? watchlists[0];
  const items = active?.items ?? [];
  const symbols = useMemo(
    () => items.filter((i) => i.type === "symbol").map((i) => i.value),
    [items],
  );

  const positionsBySymbol = useMemo(() => {
    const map = new Map<string, Position>();
    for (const p of allPositions) {
      if (p.positionAmt !== 0) map.set(p.symbol, p);
    }
    return map;
  }, [allPositions]);

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down" | null>>({});
  const applyTick = useBatchedTicks(setRows, setFlash);
  const [manageOpen, setManageOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [actionsFor, setActionsFor] = useState<WatchlistItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchFlagOpen, setBatchFlagOpen] = useState(false);
  const [moveListOpen, setMoveListOpen] = useState<"item" | "batch" | null>(null);

  const collapsed = useMemo(() => new Set(collapsedLabels), [collapsedLabels]);

  // Live ticks — same split-by-source WS subscription as desktop.
  useEffect(() => {
    if (symbols.length === 0) {
      setRows({});
      return;
    }
    let cancelled = false;
    const bybitSyms = symbols.filter((s) => resolveSource(s).kind === "bybit");
    const binanceSyms = symbols.filter((s) => resolveSource(s).kind !== "bybit");

    function seed(tickers: { symbol: string; lastPrice: number; priceChangePercent: number }[]) {
      if (cancelled) return;
      setRows((prev) => {
        const next = { ...prev };
        tickers.forEach((t) => {
          next[t.symbol] = { symbol: t.symbol, price: t.lastPrice, pct: t.priceChangePercent };
        });
        return next;
      });
    }
    if (binanceSyms.length > 0) fetchTickers24h(binanceSyms).then(seed).catch(console.error);
    if (bybitSyms.length > 0) fetchBybitTickers24h(bybitSyms).then(seed).catch(console.error);

    const unsubs: (() => void)[] = [];
    if (binanceSyms.length > 0) unsubs.push(getBinanceWS().subscribeMiniTickers(binanceSyms, applyTick));
    if (bybitSyms.length > 0) unsubs.push(getBybitWS().subscribeMiniTickers(bybitSyms, applyTick));

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [symbols.join(",")]);

  const visibleItems = useMemo(() => {
    let hidingUnder: string | null = null;
    return items.filter((item) => {
      if (item.type === "label") {
        hidingUnder = collapsed.has(item.id) ? item.id : null;
        return true;
      }
      return hidingUnder === null;
    });
  }, [items, collapsed]);

  const displayItems = useMemo(
    () => sortWatchlistItems(visibleItems, rows, sort),
    [visibleItems, rows, sort],
  );
  const isSorted = sort.key !== "manual";
  const selectMode = selected.size > 0;

  // Drag-to-reorder — pointer-based (HTML5 dragstart/drop don't fire from
  // touch), driven from each row's grip handle via setPointerCapture so
  // move/up events keep routing to it even once the finger leaves the row.
  const draggingId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Every handler below stops propagation — the handle sits inside a row
  // that has its own pointerdown/up listeners for long-press-to-select and
  // tap-to-open, and (with setPointerCapture) these events keep bubbling
  // from the handle's place in the DOM tree even while captured. Without
  // this, dragging a row would also fire the row's tap-to-open handler.
  function handleDragPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingId.current = id;
    setDragOverId(id);
  }
  function handleDragPointerMove(e: React.PointerEvent) {
    e.stopPropagation();
    if (!draggingId.current) return;
    let closestId: string | null = null;
    let closestDist = Infinity;
    for (const [id, el] of rowRefs.current) {
      const r = el.getBoundingClientRect();
      const dist = Math.abs(e.clientY - (r.top + r.height / 2));
      if (dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    }
    if (closestId) setDragOverId(closestId);
  }
  function handleDragPointerUp(e: React.PointerEvent) {
    e.stopPropagation();
    if (active && draggingId.current && dragOverId && dragOverId !== draggingId.current) {
      reorderWatchlistItems(active.id, draggingId.current, dragOverId);
    }
    draggingId.current = null;
    setDragOverId(null);
  }
  // A cancelled gesture (e.g. the OS takes over for a system gesture) should
  // just abort, not commit whatever position was last under the finger.
  function handleDragPointerCancel(e: React.PointerEvent) {
    e.stopPropagation();
    draggingId.current = null;
    setDragOverId(null);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function open(item: WatchlistItem) {
    if (item.type !== "symbol") return;
    if (selectMode) {
      toggleSelected(item.id);
      return;
    }
    setSymbol(item.value);
    setTab("chart");
  }

  function addLabelHere(beforeId?: string) {
    if (!active) return;
    const text = window.prompt("Section label:");
    if (text && text.trim()) addLabelToWatchlist(active.id, text.trim(), beforeId);
  }

  function startRename(item: WatchlistItem) {
    setRenamingId(item.id);
    setRenameDraft(item.value);
    setActionsFor(null);
  }
  function commitRename() {
    if (renamingId && active) {
      const v = renameDraft.trim();
      if (v) renameWatchlistItem(active.id, renamingId, v);
    }
    setRenamingId(null);
  }

  function createNewList() {
    const name = window.prompt("New watchlist name:");
    if (name && name.trim()) createWatchlist(name.trim());
  }
  function renameList() {
    if (!active) return;
    const name = window.prompt("Watchlist name:", active.name);
    if (name && name.trim()) renameWatchlist(active.id, name.trim());
  }
  function deleteList() {
    if (!active) return;
    if (watchlists.length <= 1) {
      window.alert("You need at least one watchlist.");
      return;
    }
    if (window.confirm(`Delete watchlist "${active.name}"?`)) {
      deleteWatchlist(active.id);
      setManageOpen(false);
    }
  }

  if (!active) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-1 border-b border-tv-border px-2 py-2">
        <button
          onClick={() => setManageOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-sm font-semibold active:bg-tv-panel-hover"
        >
          <span className="truncate">{active.name}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-tv-text-muted" />
        </button>
        <button
          onClick={() => addLabelHere(undefined)}
          className="rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Add label"
        >
          <Type className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setSymbolDialogInsertAfterId(null);
            openSymbolDialog(true);
          }}
          className="rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
          aria-label="Add symbol"
        >
          <Plus className="h-4 w-4" />
        </button>
      </header>

      {/* Sort row */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_auto] gap-2 border-b border-tv-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-muted">
        <span>Symbol</span>
        <SortHeader
          label="Price"
          active={sort.key === "price"}
          dir={sort.dir}
          onClick={() => setWatchlistSort(cycleSort(sort, "price"))}
        />
        <SortHeader
          label="24h"
          active={sort.key === "change"}
          dir={sort.dir}
          onClick={() => setWatchlistSort(cycleSort(sort, "change"))}
        />
      </div>

      {/* Multi-select action bar */}
      {selectMode && (
        <div className="flex shrink-0 items-center gap-1 border-b border-tv-border bg-tv-blue/10 px-2 py-1.5">
          <span className="flex-1 text-[11px] font-medium">{selected.size} selected</span>
          <div className="relative">
            <button
              onClick={() => setBatchFlagOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Set flag color"
            >
              <FlagPennant color={null} height={17} />
            </button>
            {batchFlagOpen && (
              <FlagSwatches
                className="absolute right-0 top-9 z-50"
                onPick={(c) => {
                  setWatchlistItemsFlag(active.id, Array.from(selected), c);
                  setBatchFlagOpen(false);
                }}
              />
            )}
          </div>
          {watchlists.length > 1 && (
            <button
              onClick={() => setMoveListOpen("batch")}
              className="flex h-8 w-8 items-center justify-center rounded text-tv-text-muted active:bg-tv-panel-hover"
              aria-label="Move to another list"
            >
              <FolderInput className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => {
              removeWatchlistItems(active.id, Array.from(selected));
              setSelected(new Set());
            }}
            className="flex h-8 w-8 items-center justify-center rounded text-tv-text-muted active:bg-tv-red/15 active:text-tv-red"
            aria-label="Remove selected"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="flex h-8 w-8 items-center justify-center rounded text-tv-text-muted active:bg-tv-panel-hover"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-6 text-center text-xs text-tv-text-muted">
            Empty list. Tap + to add symbols.
          </div>
        ) : (
          displayItems.map((item) => {
            const isDragTarget = dragOverId === item.id && draggingId.current !== item.id;
            const showHandle = !isSorted && !selectMode;

            if (item.type === "label") {
              const isCollapsed = collapsed.has(item.id);
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.id, el);
                    else rowRefs.current.delete(item.id);
                  }}
                  className={cn(
                    "flex items-center gap-1 border-y border-tv-border bg-tv-bg/50 px-1 py-1.5",
                    isDragTarget && "border-t-2 border-t-tv-blue",
                  )}
                >
                  {showHandle ? (
                    <button
                      onPointerDown={(e) => handleDragPointerDown(e, item.id)}
                      onPointerMove={handleDragPointerMove}
                      onPointerUp={handleDragPointerUp}
                      onPointerCancel={handleDragPointerCancel}
                      style={{ touchAction: "none" }}
                      className="shrink-0 p-1 text-tv-text-dim"
                      aria-label="Drag to reorder"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                  <button
                    onClick={() => toggleWatchlistLabelCollapsed(item.id)}
                    className="shrink-0 p-0.5 text-tv-text-dim"
                    aria-label={isCollapsed ? "Expand section" : "Collapse section"}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {renamingId === item.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="flex-1 bg-transparent text-[10px] font-semibold uppercase tracking-wider text-tv-text outline-none"
                    />
                  ) : (
                    <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
                      {item.value}
                    </span>
                  )}
                  <button
                    onClick={() => setActionsFor(item)}
                    className="shrink-0 p-1.5 text-tv-text-dim"
                    aria-label="Label actions"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <SymbolRow
                key={item.id}
                item={item}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(item.id, el);
                  else rowRefs.current.delete(item.id);
                }}
                row={rows[item.value]}
                flash={flash[item.value] ?? null}
                isActive={item.value === symbol}
                isSelected={selected.has(item.id)}
                selectMode={selectMode}
                showHandle={showHandle}
                isDragTarget={isDragTarget}
                posSide={(() => {
                  const rowMatchesExchange = resolveSource(item.value).kind === tradingExchange;
                  const openPosition = rowMatchesExchange
                    ? positionsBySymbol.get(cleanSym(item.value))
                    : undefined;
                  return openPosition?.side === "LONG" || openPosition?.side === "SHORT"
                    ? openPosition.side
                    : null;
                })()}
                onOpen={() => open(item)}
                onLongPress={() => toggleSelected(item.id)}
                onDragPointerDown={(e) => handleDragPointerDown(e, item.id)}
                onDragPointerMove={handleDragPointerMove}
                onDragPointerUp={handleDragPointerUp}
                onDragPointerCancel={handleDragPointerCancel}
                onMore={() => setActionsFor(item)}
                onRemove={() => removeWatchlistItem(active.id, item.id)}
              />
            );
          })
        )}
      </div>

      {/* Manage watchlists sheet */}
      {manageOpen && (
        <MobileSheet title="Watchlists" onClose={() => setManageOpen(false)}>
          {watchlists.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                setActiveWatchlist(w.id);
                setSelected(new Set());
                setManageOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between border-b border-tv-border/60 px-4 py-3 text-left text-sm",
                w.id === activeWatchlistId ? "bg-tv-blue/15 text-tv-blue-text" : "text-tv-text active:bg-tv-panel-hover",
              )}
            >
              {w.name}
            </button>
          ))}
          <div className="mt-2">
            <SheetAction icon={ListPlus} label="New watchlist…" onClick={createNewList} />
            <SheetAction icon={Pencil} label="Rename current…" onClick={renameList} />
            <SheetAction
              icon={Copy}
              label="Duplicate current"
              onClick={() => active && duplicateWatchlist(active.id)}
            />
            <SheetAction
              icon={ListX}
              label="Remove all items"
              onClick={() => {
                if (active && items.length > 0 && window.confirm(`Remove all items from "${active.name}"?`)) {
                  clearWatchlistItems(active.id);
                }
              }}
            />
            <SheetAction icon={Trash2} label="Delete current" danger onClick={deleteList} />
          </div>
        </MobileSheet>
      )}

      {/* Per-item actions sheet */}
      {actionsFor && active && (
        <MobileSheet
          title={actionsFor.type === "label" ? actionsFor.value : stripExchangePrefix(actionsFor.value)}
          onClose={() => setActionsFor(null)}
        >
          {actionsFor.type === "label" ? (
            <SheetAction icon={Pencil} label="Rename label…" onClick={() => startRename(actionsFor)} />
          ) : (
            <>
              <div className="border-b border-tv-border/60 px-4 py-3">
                <span className="mb-2 block text-[10px] uppercase tracking-wider text-tv-text-muted">
                  Flag color
                </span>
                <FlagSwatches
                  onPick={(c) => {
                    setWatchlistItemFlag(active.id, actionsFor.id, c);
                    setActionsFor(null);
                  }}
                />
              </div>
              <SheetAction
                icon={Type}
                label="Add label above"
                onClick={() => {
                  addLabelHere(actionsFor.id);
                  setActionsFor(null);
                }}
              />
              <SheetAction
                icon={Plus}
                label="Add symbol after…"
                onClick={() => {
                  setSymbolDialogInsertAfterId(actionsFor.id);
                  openSymbolDialog(true);
                  setActionsFor(null);
                }}
              />
              {watchlists.length > 1 && (
                <SheetAction
                  icon={FolderInput}
                  label="Move to another list…"
                  onClick={() => setMoveListOpen("item")}
                />
              )}
              <SheetAction
                icon={X}
                label="Remove from watchlist"
                danger
                onClick={() => {
                  removeWatchlistItem(active.id, actionsFor.id);
                  setActionsFor(null);
                }}
              />
            </>
          )}
        </MobileSheet>
      )}

      {/* "Move to list" picker — shared by the per-item sheet and the batch bar */}
      {moveListOpen && active && (
        <MobileSheet title="Move to…" onClose={() => setMoveListOpen(null)}>
          {watchlists.filter((w) => w.id !== active.id).map((w) => (
            <button
              key={w.id}
              onClick={() => {
                if (moveListOpen === "batch") {
                  for (const id of selected) moveWatchlistItemToList(active.id, w.id, id);
                  setSelected(new Set());
                } else if (actionsFor) {
                  moveWatchlistItemToList(active.id, w.id, actionsFor.id);
                }
                setMoveListOpen(null);
                setActionsFor(null);
              }}
              className="block w-full border-b border-tv-border/60 px-4 py-3 text-left text-sm text-tv-text active:bg-tv-panel-hover"
            >
              {w.name}
            </button>
          ))}
        </MobileSheet>
      )}
    </div>
  );
}

/** A single symbol row: tap opens the chart (or toggles selection in select
 *  mode), long-press enters select mode, the grip handle drags to reorder. */
function SymbolRow({
  item, rowRef, row, flash, isActive, isSelected, selectMode, showHandle, isDragTarget, posSide,
  onOpen, onLongPress, onDragPointerDown, onDragPointerMove, onDragPointerUp, onDragPointerCancel,
  onMore, onRemove,
}: {
  item: Extract<WatchlistItem, { type: "symbol" }>;
  rowRef: (el: HTMLElement | null) => void;
  row: Row | undefined;
  flash: "up" | "down" | null;
  isActive: boolean;
  isSelected: boolean;
  selectMode: boolean;
  showHandle: boolean;
  isDragTarget: boolean;
  posSide: "LONG" | "SHORT" | null;
  onOpen: () => void;
  onLongPress: () => void;
  onDragPointerDown: (e: React.PointerEvent) => void;
  onDragPointerMove: (e: React.PointerEvent) => void;
  onDragPointerUp: (e: React.PointerEvent) => void;
  onDragPointerCancel: (e: React.PointerEvent) => void;
  onMore: () => void;
  onRemove: () => void;
}) {
  const s = item.value;
  const displaySymbol = stripExchangePrefix(s);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    longPressed.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }
  function onPointerMove(e: React.PointerEvent) {
    const start = pressStart.current;
    if (!start || !pressTimer.current) return;
    if (Math.abs(e.clientX - start.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - start.y) > LONG_PRESS_SLOP) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  function onPointerUp() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (!longPressed.current) onOpen();
  }
  function onPointerCancel() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }

  return (
    <div
      ref={rowRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        "grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-1.5 border-b border-tv-border/60 py-2.5 pl-1 pr-2 active:bg-tv-panel-hover",
        isActive && !selectMode && "bg-tv-panel-hover",
        isSelected && "bg-tv-blue/15",
        isDragTarget && "border-t-2 border-t-tv-blue",
      )}
    >
      {selectMode ? (
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
            isSelected ? "border-tv-blue bg-tv-blue" : "border-tv-border",
          )}
        >
          {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
        </span>
      ) : showHandle ? (
        <button
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerCancel}
          style={{ touchAction: "none" }}
          className="shrink-0 p-1 text-tv-text-dim"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      {item.flagColor ? (
        <FlagPennant color={item.flagColor} height={16} />
      ) : (
        // Same footprint as the tag, so flagged and unflagged rows align.
        <span className="w-[9px] shrink-0" />
      )}

      <div className="flex min-w-0 items-center gap-1.5">
        <CoinIcon symbol={displaySymbol} size={18} />
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {posSide ? getBaseAsset(displaySymbol) : displaySymbol}
            {posSide && <PositionSideBadge side={posSide} />}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-tv-text-muted">
            {resolveSource(s).kind === "bybit" ? "Bybit" : "Binance"}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span
          className={cn(
            "font-mono text-sm tabular-nums transition-colors",
            flash === "up" && "text-tv-green",
            flash === "down" && "text-tv-red",
            !flash && "text-tv-text",
          )}
        >
          {row ? formatPrice(row.price) : "—"}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-px font-mono text-[10px] tabular-nums",
            row ? (row.pct >= 0 ? "bg-tv-green/15 text-tv-green" : "bg-tv-red/15 text-tv-red") : "text-tv-text-muted",
          )}
        >
          {row ? formatPct(row.pct) : "—"}
        </span>
      </div>

      {!selectMode && (
        // Pointer events (not just click) must stop here too — they bubble to
        // the row's own pointerdown/up handlers, which drive long-press and
        // tap-to-open; without this, tapping × would also open the chart.
        <div className="flex items-center" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMore();
            }}
            className="rounded p-1.5 text-tv-text-dim"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded p-1.5 text-tv-text-dim active:text-tv-red"
            aria-label={`Remove ${s} from watchlist`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function FlagSwatches({ onPick, className }: { onPick: (color: string | null) => void; className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-1.5 rounded border border-tv-border bg-tv-panel p-2 shadow-lg",
        className,
      )}
    >
      {FLAG_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="h-6 w-6 rounded-sm transition-opacity active:opacity-70"
          style={{ backgroundColor: c }}
          aria-label={`Set flag to ${c}`}
        />
      ))}
      <button
        onClick={() => onPick(null)}
        className="flex h-6 w-6 items-center justify-center rounded-sm border border-tv-border text-tv-text-muted active:text-tv-red"
        aria-label="Remove flag"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SheetAction({
  icon: Icon, label, danger, onClick,
}: {
  icon: typeof Plus;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-tv-border/60 px-4 py-3 text-left text-sm active:bg-tv-panel-hover",
        danger ? "text-tv-red" : "text-tv-text",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

/** Hollow circle badge marking an open Long/Short position on a watchlist row. */
function PositionSideBadge({ side }: { side: "LONG" | "SHORT" }) {
  const isLong = side === "LONG";
  return (
    <span
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold",
        // Blue is *direction* (long), red is *movement* (down) — the badge for a
        // short reuses the down color on purpose. See CLAUDE.md's color rule.
        isLong ? "border-tv-blue text-tv-blue-text" : "border-tv-red text-tv-red",
      )}
    >
      {isLong ? "L" : "S"}
    </span>
  );
}

/** Clickable, sort-aware column header (Price / 24h). */
function SortHeader({
  label, active, dir, onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-end gap-0.5 text-right uppercase tracking-wider",
        active ? "text-tv-blue-text" : "text-tv-text-dim",
      )}
    >
      <span>{label}</span>
      {active && (dir === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />)}
    </button>
  );
}
