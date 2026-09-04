"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderInput,
  GripVertical,
  ListPlus,
  ListX,
  Pencil,
  Plus,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { fetchTickers24h, cleanSym } from "@/lib/binance/rest";
import { fetchBybitTickers24h } from "@/lib/bybit/public";
import { sortWatchlistItems, cycleSort } from "@/lib/watchlist/sort";
import { getBinanceWS } from "@/lib/binance/ws";
import { getBybitWS } from "@/lib/bybit/ws";
import { resolveSource } from "@/lib/symbols/source";
import { stripExchangePrefix } from "@/lib/symbols/prefix";
import { useChartStore, type WatchlistItem } from "@/lib/store/chart-store";
import { useTradingStore } from "@/lib/store/trading-store";
import type { Position } from "@/lib/binance/trading-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatPrice, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBatchedTicks } from "@/hooks/useBatchedTicks";
import { CoinIcon, getBaseAsset } from "./CoinIcon";
import { FlagPennant } from "./FlagPennant";
import { FLAG_COLORS } from "@/lib/watchlist/flags";

interface Row {
  symbol: string;
  price: number;
  pct: number;
}

export function Watchlist() {
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
  const lastFlagColor = useChartStore((s) => s.lastFlagColor);
  const setLastFlagColor = useChartStore((s) => s.setLastFlagColor);
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
  const allPositions = useTradingStore((s) => s.allPositions);
  const tradingExchange = useTradingStore((s) => s.exchange);

  const active = watchlists.find((w) => w.id === activeWatchlistId) ?? watchlists[0];
  const items = active?.items ?? [];
  const symbols = useMemo(
    () => items.filter((i) => i.type === "symbol").map((i) => i.value),
    [items],
  );

  // Open positions keyed by bare exchange symbol (e.g. "SOLUSDT"), so a
  // watchlist row can be matched regardless of its BYBIT:/​.P decoration.
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    itemId: string | null;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [flagPickerId, setFlagPickerId] = useState<string | null>(null);
  const [batchFlagPickerOpen, setBatchFlagPickerOpen] = useState(false);

  // Multi-select (Ctrl/Cmd toggles one, Shift extends from the last click)
  // for batch remove / flag-color actions.
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

  useEffect(() => {
    if (!flagPickerId) return;
    function close() { setFlagPickerId(null); }
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [flagPickerId]);

  useEffect(() => {
    if (!batchFlagPickerOpen) return;
    function close() { setBatchFlagPickerOpen(false); }
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [batchFlagPickerOpen]);

  // Drag & drop state
  const draggedId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Collapsed label sections (persisted; ids scoped globally but only the
  // active watchlist's labels are ever looked up against this set)
  const collapsed = useMemo(() => new Set(collapsedLabels), [collapsedLabels]);

  useEffect(() => {
    if (symbols.length === 0) {
      setRows({});
      return;
    }
    let cancelled = false;

    // Split by data source: Bybit-exclusive perps stream from Bybit, everything
    // else (shared perps, spot, stocks) from Binance.
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

  useEffect(() => {
    if (!contextMenu) return;
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-watchlist-context]")) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [contextMenu]);

  // Clamp the context menu to the viewport — its item count varies (label
  // rename, "move to list" entries scale with watchlist count), so it can't
  // be measured up front. Runs before paint so there's no visible jump; a
  // right-click near the bottom/edge of the list no longer opens a menu
  // that spills off-screen and gets clipped.
  const contextMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const maxTop = window.innerHeight - rect.height - margin;
    const maxLeft = window.innerWidth - rect.width - margin;
    el.style.top = `${Math.max(margin, Math.min(contextMenu.y, maxTop))}px`;
    el.style.left = `${Math.max(margin, Math.min(contextMenu.x, maxLeft))}px`;
  }, [contextMenu]);

  function addLabelHere(beforeId?: string) {
    if (!active) return;
    const text = window.prompt("Section label:");
    if (text && text.trim()) {
      addLabelToWatchlist(active.id, text.trim(), beforeId);
    }
    setContextMenu(null);
  }

  function startRename(itemId: string, current: string) {
    setRenamingId(itemId);
    setRenameDraft(current);
    setContextMenu(null);
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
    if (name && name.trim()) {
      createWatchlist(name.trim());
      setMultiSelected(new Set());
    }
  }

  function renameList() {
    if (!active) return;
    const name = window.prompt("Watchlist name:", active.name);
    if (name && name.trim()) {
      renameWatchlist(active.id, name.trim());
    }
  }

  function deleteList() {
    if (!active) return;
    if (watchlists.length <= 1) {
      window.alert("You need at least one watchlist.");
      return;
    }
    if (window.confirm(`Delete watchlist "${active.name}"?`)) {
      deleteWatchlist(active.id);
      setMultiSelected(new Set());
    }
  }

  function openContextMenu(e: React.MouseEvent, itemId: string | null) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, itemId });
  }

  function toggleCollapse(labelId: string) {
    toggleWatchlistLabelCollapsed(labelId);
  }

  // Build visible items respecting collapsed sections
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

  // Apply active sort (manual = unchanged; price/change = flat sorted symbols).
  const displayItems = useMemo(
    () => sortWatchlistItems(visibleItems, rows, sort),
    [visibleItems, rows, sort],
  );
  const isSorted = sort.key !== "manual";

  function handleRowClick(e: React.MouseEvent, item: WatchlistItem) {
    if (item.type !== "symbol") return;
    if (e.shiftKey && lastClickedRef.current) {
      const ids = displayItems.filter((i) => i.type === "symbol").map((i) => i.id);
      const a = ids.indexOf(lastClickedRef.current);
      const b = ids.indexOf(item.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = ids.slice(lo, hi + 1);
        setMultiSelected((prev) => new Set([...prev, ...range]));
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      lastClickedRef.current = item.id;
      return;
    }
    if (multiSelected.size > 0) {
      setMultiSelected(new Set());
      return;
    }
    setSymbol(item.value);
    lastClickedRef.current = item.id;
  }

  // Drag handlers
  function handleDragStart(id: string) {
    draggedId.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (draggedId.current !== id) setDragOverId(id);
  }

  function handleDrop(targetId: string) {
    if (!active || !draggedId.current || draggedId.current === targetId) {
      draggedId.current = null;
      setDragOverId(null);
      return;
    }
    reorderWatchlistItems(active.id, draggedId.current, targetId);
    draggedId.current = null;
    setDragOverId(null);
  }

  function handleDragEnd() {
    draggedId.current = null;
    setDragOverId(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-1 border-b border-tv-border px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider text-tv-text hover:bg-tv-panel-hover">
            <span className="truncate">{active?.name ?? "Watchlist"}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-tv-text-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48 bg-tv-panel">
            {watchlists.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => {
                  setActiveWatchlist(w.id);
                  setMultiSelected(new Set());
                }}
                className={cn(
                  "text-xs",
                  w.id === activeWatchlistId && "bg-tv-blue/15 text-tv-blue-text",
                )}
              >
                {w.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={createNewList} className="text-xs">
              <ListPlus className="h-3.5 w-3.5" />
              <span>New watchlist…</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={renameList} className="text-xs">
              <Pencil className="h-3.5 w-3.5" />
              <span>Rename current…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (active) duplicateWatchlist(active.id);
                setMultiSelected(new Set());
              }}
              className="text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Duplicate current</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (active && items.length > 0 && window.confirm(`Remove all items from "${active.name}"?`)) {
                  clearWatchlistItems(active.id);
                }
              }}
              className="text-xs"
            >
              <ListX className="h-3.5 w-3.5" />
              <span>Remove all items</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={deleteList} className="text-xs text-tv-red">
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete current</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => openSymbolDialog(true)}
          className="rounded p-1 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          title="Add symbol"
          aria-label="Add symbol"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-tv-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-muted">
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
      {multiSelected.size > 0 && active && (
        <div className="flex items-center gap-1.5 border-b border-tv-border bg-tv-blue/10 px-2 py-1.5">
          <span className="flex-1 text-[11px] font-medium text-tv-text">
            {multiSelected.size} selected
          </span>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setBatchFlagPickerOpen((v) => !v);
              }}
              title="Set flag color"
              className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
            >
              <FlagPennant color={null} height={14} />
            </button>
            {batchFlagPickerOpen && (
              <div
                className="absolute right-0 top-7 z-50 flex gap-1 rounded bg-tv-popup p-1.5 shadow-lg ring-1 ring-tv-border-strong"
                onClick={(e) => e.stopPropagation()}
              >
                {FLAG_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setWatchlistItemsFlag(active.id, Array.from(multiSelected), c);
                      setLastFlagColor(c);
                      setBatchFlagPickerOpen(false);
                    }}
                    className="h-5 w-5 rounded-sm transition-opacity hover:opacity-80"
                    style={{ backgroundColor: c }}
                    aria-label={`Set flag to ${c}`}
                  />
                ))}
                <button
                  onClick={() => {
                    setWatchlistItemsFlag(active.id, Array.from(multiSelected), null);
                    setBatchFlagPickerOpen(false);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-sm border border-tv-border text-tv-text-muted hover:text-tv-red"
                  aria-label="Remove flag"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
          {watchlists.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Move to another list"
                className="flex h-6 w-6 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
              >
                <FolderInput className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40 bg-tv-panel">
                {watchlists.filter((w) => w.id !== active.id).map((w) => (
                  <DropdownMenuItem
                    key={w.id}
                    onClick={() => {
                      for (const id of multiSelected) moveWatchlistItemToList(active.id, w.id, id);
                      setMultiSelected(new Set());
                    }}
                    className="text-xs"
                  >
                    {w.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={() => {
              removeWatchlistItems(active.id, Array.from(multiSelected));
              setMultiSelected(new Set());
            }}
            title="Remove selected"
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
      {/* `min-h-0` is load-bearing: a flex item defaults to `min-height:auto`,
          which resolves to its content height, so without it the scroll root
          grows past the sidebar instead of shrinking — the rows below the fold
          get clipped by the sidebar's `overflow-hidden` and never scroll. */}
      <ScrollArea className="min-h-0 flex-1">
        <div
          className="flex flex-col"
          onContextMenu={(e) => openContextMenu(e, null)}
        >
          {displayItems.map((item) => {
            const isDragTarget = dragOverId === item.id;

            if (item.type === "label") {
              const isCollapsed = collapsed.has(item.id);
              return (
                <div
                  key={item.id}
                  draggable={!isSorted}
                  onDragStart={() => handleDragStart(item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDrop={() => handleDrop(item.id)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    openContextMenu(e, item.id);
                  }}
                  onDoubleClick={() => startRename(item.id, item.value)}
                  className={cn(
                    "group flex items-center gap-1 border-y border-tv-border bg-tv-panel-hover px-1 py-1",
                    !isSorted && "cursor-grab active:cursor-grabbing",
                    isDragTarget && "border-t-2 border-t-tv-blue",
                  )}
                >
                  <GripVertical className="h-3 w-3 shrink-0 text-tv-text-dim opacity-0 transition-opacity group-hover:opacity-100" />
                  <button
                    onClick={() => toggleCollapse(item.id)}
                    className="shrink-0 text-tv-text-dim hover:text-tv-text"
                    aria-label={isCollapsed ? "Expand section" : "Collapse section"}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
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
                    <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
                      {item.value}
                    </span>
                  )}
                </div>
              );
            }

            const s = item.value;
            // Always display the plain ticker (BYBIT:BTCUSDT.P -> BTCUSDT.P),
            // regardless of which exchange it actually resolves to.
            const displaySymbol = stripExchangePrefix(s);
            // Only badge this row when it belongs to the connected trading
            // exchange's market — a bare ticker can match a position by symbol
            // alone even though it's actually a different exchange's chart
            // (e.g. plain "SOLUSDT.P" vs "BYBIT:SOLUSDT.P").
            const rowMatchesExchange = resolveSource(s).kind === tradingExchange;
            const openPosition = rowMatchesExchange ? positionsBySymbol.get(cleanSym(s)) : undefined;
            const posSide = openPosition?.side === "LONG" || openPosition?.side === "SHORT"
              ? openPosition.side
              : null;
            const row = rows[s];
            const isActive = s === symbol;
            const isMultiSelected = multiSelected.has(item.id);
            const f = flash[s];
            return (
              <div
                key={item.id}
                draggable={!isSorted}
                onDragStart={() => handleDragStart(item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDrop={() => handleDrop(item.id)}
                onDragEnd={handleDragEnd}
                onClick={(e) => handleRowClick(e, item)}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  openContextMenu(e, item.id);
                }}
                // No drag handle: `draggable` is on the row itself, so a
                // grip column would only take space from the ticker.
                className={cn(
                  "group relative grid cursor-pointer grid-cols-[12px_1fr_auto_auto] items-center gap-1 py-1.5 pr-1 text-xs transition-colors",
                  "hover:bg-tv-panel-hover",
                  isActive && !isMultiSelected && "bg-tv-panel-hover",
                  isMultiSelected && "bg-tv-blue/15",
                  isDragTarget && "border-t-2 border-t-tv-blue",
                )}
              >
                {/* Flag: click toggles it, right-click picks the colour. */}
                <div className="relative self-stretch">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!active) return;
                      // Toggle with the last colour used, so flagging a run of
                      // symbols the same colour is one click each.
                      setWatchlistItemFlag(
                        active.id,
                        item.id,
                        item.flagColor ? null : lastFlagColor,
                      );
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFlagPickerId(flagPickerId === item.id ? null : item.id);
                    }}
                    title={
                      item.flagColor
                        ? "Remove flag (right-click to change colour)"
                        : "Add flag (right-click to pick a colour)"
                    }
                    aria-label={item.flagColor ? "Remove flag" : "Add flag"}
                    className={cn(
                      // Flush left: the tag reads as part of the panel edge,
                      // the way TradingView marks a flagged row.
                      "flex h-full w-full items-center justify-start transition-opacity",
                      // An unflagged row only shows the hollow outline on hover,
                      // so the column stays quiet but the target is findable.
                      item.flagColor
                        ? "opacity-100"
                        : "text-tv-text-dim opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <FlagPennant color={item.flagColor ?? null} />
                  </button>
                  {flagPickerId === item.id && (
                    <div
                      className="absolute left-0 top-5 z-50 flex gap-1 rounded bg-tv-popup p-1.5 shadow-lg ring-1 ring-tv-border-strong"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {FLAG_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => {
                            if (active) setWatchlistItemFlag(active.id, item.id, c);
                            setLastFlagColor(c);
                            setFlagPickerId(null);
                          }}
                          className="h-5 w-5 rounded-sm transition-opacity hover:opacity-80"
                          style={{ backgroundColor: c }}
                          aria-label={`Set flag to ${c}`}
                        />
                      ))}
                      <button
                        onClick={() => {
                          if (active) setWatchlistItemFlag(active.id, item.id, null);
                          setFlagPickerId(null);
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-sm border border-tv-border text-tv-text-muted hover:text-tv-red"
                        aria-label="Remove flag"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <CoinIcon symbol={displaySymbol} size={16} />
                  <span className="truncate font-medium text-tv-text">
                    {posSide ? getBaseAsset(displaySymbol) : displaySymbol}
                  </span>
                  {posSide && <PositionSideBadge side={posSide} />}
                </div>
                <span
                  className={cn(
                    "text-right tabular-nums transition-colors",
                    f === "up" && "text-tv-green",
                    f === "down" && "text-tv-red",
                    !f && "text-tv-text",
                  )}
                >
                  {row ? formatPrice(row.price) : "—"}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <span
                    className={cn(
                      "tabular-nums",
                      row
                        ? row.pct >= 0
                          ? "text-tv-green"
                          : "text-tv-red"
                        : "text-tv-text-muted",
                    )}
                  >
                    {row ? formatPct(row.pct) : "—"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (active) removeWatchlistItem(active.id, item.id);
                    }}
                    className="invisible rounded p-0.5 text-tv-text-muted hover:bg-tv-bg hover:text-tv-red group-hover:visible"
                    aria-label={`Remove ${s} from watchlist`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="p-4 text-center text-xs text-tv-text-muted">
              Empty watchlist. Right-click to add items.
            </div>
          )}
        </div>
      </ScrollArea>

      {contextMenu && active && (
        <div
          ref={contextMenuRef}
          data-watchlist-context
          style={{ top: contextMenu.y, left: contextMenu.x, maxHeight: "80vh" }}
          className="fixed z-50 min-w-44 overflow-y-auto rounded-md bg-tv-popup py-1 shadow-xl ring-1 ring-tv-border-strong"
        >
          {contextMenu.itemId !== null && (
            <>
              {(() => {
                const item = items.find((i) => i.id === contextMenu.itemId);
                if (item?.type === "label") {
                  return (
                    <ContextItem
                      icon={Pencil}
                      label="Rename label…"
                      onClick={() => startRename(item.id, item.value)}
                    />
                  );
                }
                return null;
              })()}
              <ContextItem
                icon={Type}
                label="Add label above"
                onClick={() => addLabelHere(contextMenu.itemId!)}
              />
              {(() => {
                const item = items.find((i) => i.id === contextMenu.itemId);
                if (item?.type !== "symbol" || watchlists.length <= 1) return null;
                return (
                  <>
                    <div className="my-1 h-px bg-tv-border" />
                    {watchlists.filter((w) => w.id !== active.id).map((w) => (
                      <ContextItem
                        key={w.id}
                        icon={FolderInput}
                        label={`Move to "${w.name}"`}
                        onClick={() => {
                          moveWatchlistItemToList(active.id, w.id, contextMenu.itemId!);
                          setContextMenu(null);
                        }}
                      />
                    ))}
                  </>
                );
              })()}
              <div className="my-1 h-px bg-tv-border" />
            </>
          )}
          <ContextItem
            icon={Plus}
            label="Add symbol…"
            onClick={() => {
              setSymbolDialogInsertAfterId(contextMenu.itemId);
              openSymbolDialog(true);
              setContextMenu(null);
            }}
          />
          <ContextItem
            icon={Type}
            label="Add label at end"
            onClick={() => addLabelHere(undefined)}
          />
          <div className="my-1 h-px bg-tv-border" />
          <ContextItem icon={ListPlus} label="New watchlist…" onClick={createNewList} />
          <ContextItem icon={Pencil} label="Rename watchlist…" onClick={renameList} />
        </div>
      )}
    </div>
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
      title={isLong ? "Open long position" : "Open short position"}
    >
      {isLong ? "L" : "S"}
    </span>
  );
}

function ContextItem({
  icon: Icon,
  label,
  danger,
  onClick,
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
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
        danger
          ? "text-tv-red hover:bg-tv-red/10"
          : "text-tv-text hover:bg-tv-panel-hover",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

/** Clickable, sort-aware column header (Price / 24h). */
function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Sort by ${label}`}
      className={cn(
        "flex items-center justify-end gap-0.5 text-right uppercase tracking-wider transition-colors hover:text-tv-text",
        active ? "text-tv-blue-text" : "text-tv-text-muted",
      )}
    >
      <span>{label}</span>
      {active &&
        (dir === "asc" ? (
          <ArrowUp className="size-4" />
        ) : (
          <ArrowDown className="size-4" />
        ))}
    </button>
  );
}
