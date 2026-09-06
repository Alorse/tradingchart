"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Pencil,
  TriangleAlert,
  X,
} from "lucide-react";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { cn } from "@/lib/utils";
import { Badge, Stat, Stub, TabBtn } from "@/components/layout/panel-bits";
import { formatPct, formatPrice } from "@/lib/format";
import { bracketEditReason } from "@/lib/trading/paper-brackets";
import {
  describePaperEvent,
  formatDuration,
  PAPER_EVENT_TONE,
  reasonLabel,
} from "@/lib/trading/paper-format";
import {
  formatPnlDisplay,
  markOf,
  paperDisplaySymbol,
  positionFiguresAt,
  PNL_DISPLAY_MODES,
  PNL_MODE_LABEL,
} from "@/lib/trading/paper-position-display";
import type { PnlDisplayMode } from "@/lib/trading/paper-position-display";
import { totalUnrealizedPnl, unrealizedPnl, positionRoi, usedMargin } from "@/lib/trading/paper-engine";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PaperAccount, PaperEvent, PaperOrder, PaperPosition, PaperTrade } from "@/lib/trading/paper-engine";

/**
 * Paper-mode counterpart to `PositionsPanel` — same docked/collapsible shell,
 * but reading `paper-trading-store` instead of exchange credentials. Both
 * panels are mounted side by side in `page.tsx`; each self-gates on
 * `trading-mode-store`'s `mode`, so only one is ever visible.
 *
 * This shell deliberately subscribes to `account` only — never `marks` or
 * `equity()`. Marks change on every raw WS tick (Bybit's feed is uncapped,
 * several a second), so subscribing here re-rendered the panel on every tick
 * even while collapsed to a 32px bar, or mounted-but-null in live mode, with
 * nothing on screen that could show the new number. The mark-driven
 * subscriptions live in `AccountSummaryRow`/`PositionsTable`
 * below, which only mount once the panel is expanded onto the relevant tab.
 *
 * The Notifications log (below) intentionally accumulates from `lastEvents`
 * BEFORE the `mode !== "paper"` early return, so the two hooks above it keep
 * running (and the log keeps growing) even while the live-mode tab is
 * showing — the paper account can still be filling/closing brackets in the
 * background, and switching back to Paper shouldn't have missed anything.
 */

type Tab = "positions" | "orders" | "history" | "notifications";

const NOTIFICATION_LOG_CAP = 50;

/** Accumulates `lastEvents` (replaced-not-appended on the store) into a
 *  capped, append-only log for the Notifications tab. */
function usePaperEventLog(cap: number): PaperEvent[] {
  const lastEvents = usePaperTradingStore((s) => s.lastEvents);
  const [log, setLog] = useState<PaperEvent[]>([]);
  useEffect(() => {
    if (lastEvents.length === 0) return;
    // Subscribing to an external store's replace-not-append signal and
    // folding it into a locally-owned accumulator, same pattern (and same
    // lint exemption) as `PaperOrderPanel`'s sizing-input sync effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLog((prev) => [...lastEvents, ...prev].slice(0, cap));
  }, [lastEvents, cap]);
  return log;
}

export function PaperPositionsPanel() {
  const mode = useTradingModeStore((s) => s.mode);
  const account = usePaperTradingStore((s) => s.account);
  const resetAccount = usePaperTradingStore((s) => s.resetAccount);
  const notifications = usePaperEventLog(NOTIFICATION_LOG_CAP);

  const [collapsed, setCollapsed] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [tab, setTab] = useState<Tab>("positions");

  if (mode !== "paper") return null;

  const positions = account.positions;
  const restingOrders = account.orders.filter((o) => o.status === "NEW");

  // Label, count and body in one row per tab: the three used to be parallel
  // lists that had to be edited in lockstep to add or reorder one.
  const tabs: { key: Tab; label: React.ReactNode; count: number; body: () => React.ReactNode }[] = [
    {
      key: "positions",
      label: "Positions",
      count: positions.length,
      body: () => <PositionsTable positions={positions} />,
    },
    {
      key: "orders",
      label: "Orders",
      count: restingOrders.length,
      body: () => <OrdersTable orders={restingOrders} />,
    },
    {
      key: "history",
      label: "History",
      count: account.history.length,
      body: () => <HistoryTable trades={account.history} />,
    },
    {
      key: "notifications",
      label: <Bell className="h-3 w-3" />,
      count: notifications.length,
      body: () => <NotificationsTable events={notifications} />,
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col border-t border-tv-border bg-tv-panel text-tv-text",
        fullscreen ? "fixed inset-0 z-40" : "",
      )}
      style={fullscreen ? {} : { maxHeight: collapsed ? 32 : "45vh", minHeight: 32 }}
    >
      {/* Title bar — same structure as PositionsPanel's, so the live and paper
          panels hit-align and hover identically. */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-8 shrink-0 items-center gap-2 border-b border-tv-border px-3 text-[11px] font-semibold transition-colors hover:bg-tv-panel-hover"
      >
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-tv-yellow" />
          Paper Trading Account
        </span>
        {positions.length > 0 && (
          <span className="rounded bg-tv-blue/20 px-1.5 py-0.5 text-[9px] font-bold text-tv-blue-text">
            {positions.length} pos
          </span>
        )}
        {restingOrders.length > 0 && (
          <span className="rounded bg-tv-yellow/20 px-1.5 py-0.5 text-[9px] font-bold text-tv-yellow">
            {restingOrders.length} orders
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {!collapsed && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setFullscreen((f) => !f);
              }}
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="rounded p-1 text-tv-text-muted hover:bg-tv-bg hover:text-tv-text"
              role="button"
            >
              {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </span>
          )}
          {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>

      {!collapsed && (
        <>
          <AccountSummaryRow account={account} onReset={resetAccount} />

          <div className="flex shrink-0 border-b border-tv-border">
            {tabs.map((t) => (
              <TabBtn
                key={t.key}
                className="flex items-center"
                active={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label} {t.count > 0 && <Badge n={t.count} />}
              </TabBtn>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            {tabs.find((t) => t.key === tab)?.body()}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── helpers ─── */

/** The mark-driven figures making up the always-visible summary row, split
 *  out of the shell so the tick-rate subscriptions only exist while the
 *  panel is open. */
function AccountSummaryRow({
  account, onReset,
}: { account: PaperAccount; onReset: () => void }) {
  const marks = usePaperTradingStore((s) => s.marks);
  const unrealized = totalUnrealizedPnl(account.positions, marks);
  const marginUsed = usedMargin(account);
  // `equity()` is defined as exactly this sum, so calling it would walk the
  // positions twice more per tick — and as a selector it ran on every store
  // `set`, not just on render.
  const equity = account.balance + marginUsed + unrealized;
  // Realized P&L is a reduce over the whole (append-only, uncapped) trade
  // history, and it depends on `account` alone — no mark anywhere in it. This
  // row re-renders on every raw WS tick, since the Unrealized/Equity stats
  // beside it are mark-driven by definition, so without the memo a long
  // history was summed from scratch several times a second for a number that
  // only moves when a trade closes.
  const realized = useMemo(
    () => account.history.reduce((sum, t) => sum + t.realizedPnl, 0),
    [account.history],
  );

  return (
    <div className="flex items-center gap-6 border-b border-tv-border px-4 py-2 text-[11px]">
      <Stat label="Balance (USDT)" value={account.balance.toFixed(2)} />
      <Stat
        label="Unrealized PnL (USDT)"
        value={`${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}`}
        valueClass={unrealized >= 0 ? "text-tv-green" : "text-tv-red"}
      />
      <Stat label="Equity (USDT)" value={equity.toFixed(2)} />
      <Stat label="Margin used (USDT)" value={marginUsed.toFixed(2)} />
      <Stat
        label="Realized PnL (USDT)"
        value={`${realized >= 0 ? "+" : ""}${realized.toFixed(2)}`}
        valueClass={realized >= 0 ? "text-tv-green" : "text-tv-red"}
      />
      <span className="ml-auto text-[9px] uppercase text-tv-text-muted">
        Paper · Simulated
      </span>
      <button
        onClick={() => {
          if (
            window.confirm(
              "Reset the paper account? This clears every position, order and closed trade, and restores the balance to its seed value. This cannot be undone.",
            )
          ) {
            onReset();
          }
        }}
        title="Reset paper account to seed balance"
        className="rounded border border-tv-red/30 px-2 py-1 text-[10px] font-semibold text-tv-red transition-colors hover:border-tv-red hover:bg-tv-red/10 hover:text-tv-red"
      >
        Reset account
      </button>
    </div>
  );
}

export function SideChip({ side }: { side: "LONG" | "SHORT" }) {
  const long = side === "LONG";
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-bold",
        long ? "bg-tv-blue/15 text-tv-blue-text" : "bg-tv-red/15 text-tv-red",
      )}
    >
      {long ? "Long" : "Short"}
    </span>
  );
}

/* ───────────────────────── Sorting ───────────────────────── */

type SortKey = "side" | "qty" | "pnl" | "roe";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function SortableTh({
  label, sortKey, sort, onSort, align,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={cn(
        "cursor-pointer select-none px-3 py-1.5 hover:text-tv-text",
        align === "right" && "text-right",
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className={cn("inline-flex items-center gap-0.5", align === "right" && "flex-row-reverse")}>
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
      </span>
    </th>
  );
}

/* ───────────────────────── Positions table ───────────────────────── */

interface PositionRow {
  position: PaperPosition;
  mark: number;
  pnl: number;
  roe: number;
}

function sortRows(rows: PositionRow[], sort: SortState | null): PositionRow[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "side":
        return a.position.side.localeCompare(b.position.side) * dir;
      case "qty":
        return (a.position.qty - b.position.qty) * dir;
      case "pnl":
        return (a.pnl - b.pnl) * dir;
      case "roe":
        return (a.roe - b.roe) * dir;
    }
  });
}

function PositionsTable({ positions }: { positions: PaperPosition[] }) {
  // Subscribed here rather than passed down from the shell: this table is the
  // only thing that renders a per-tick mark, and it only exists while the
  // Positions tab is open.
  const marks = usePaperTradingStore((s) => s.marks);
  const pnlDisplayMode = usePaperTradingStore((s) => s.pnlDisplayMode);
  const setPnlDisplayMode = usePaperTradingStore((s) => s.setPnlDisplayMode);
  const [sort, setSort] = useState<SortState | null>(null);
  const [editing, setEditing] = useState<PaperPosition | null>(null);
  const [closing, setClosing] = useState<{ position: PaperPosition; initialQty: number } | null>(null);
  const [reversing, setReversing] = useState<PaperPosition | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; position: PaperPosition } | null>(null);

  function onSort(key: SortKey) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  if (positions.length === 0) {
    return <Stub message="No open positions" />;
  }

  const rows = sortRows(
    positions.map((position) => {
      const mark = markOf(marks, position);
      return { position, mark, pnl: unrealizedPnl(position, mark), roe: positionRoi(position, mark) * 100 };
    }),
    sort,
  );

  return (
    <div>
      <div className="flex items-center justify-end gap-1 border-b border-tv-border px-3 py-1">
        <span className="text-[9px] uppercase text-tv-text-muted">uPnL</span>
        {PNL_DISPLAY_MODES.map((m) => (
          <button
            key={m}
            onClick={() => setPnlDisplayMode(m)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[9px] font-semibold",
              m === pnlDisplayMode
                ? "bg-tv-blue/20 text-tv-blue-text"
                : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            {PNL_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-tv-border text-left text-[10px] uppercase tracking-wider text-tv-text-muted">
            <th className="px-3 py-1.5">Symbol</th>
            <SortableTh label="Side" sortKey="side" sort={sort} onSort={onSort} />
            <SortableTh label="Qty" sortKey="qty" sort={sort} onSort={onSort} />
            <th className="px-3 py-1.5">Avg price</th>
            <th className="px-3 py-1.5">Mark price</th>
            <th className="px-3 py-1.5">Liq. price</th>
            <th className="px-3 py-1.5">Leverage</th>
            <th className="px-3 py-1.5">Take Profit</th>
            <th className="px-3 py-1.5">Stop Loss</th>
            <SortableTh label="uPnL" sortKey="pnl" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="ROE%" sortKey="roe" sort={sort} onSort={onSort} align="right" />
            <th className="px-3 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ position, mark }) => (
            <PositionRow
              key={position.id}
              position={position}
              mark={mark}
              pnlDisplayMode={pnlDisplayMode}
              onEdit={() => setEditing(position)}
              onClose={() => setClosing({ position, initialQty: position.qty })}
              onReverse={() => setReversing(position)}
              onMenu={(x, y) => setMenu({ x, y, position })}
            />
          ))}
        </tbody>
      </table>

      {editing && <EditPositionDialog position={editing} onOpenChange={(open) => !open && setEditing(null)} />}
      {closing && (
        <ClosePositionDialog
          position={closing.position}
          initialQty={closing.initialQty}
          onOpenChange={(open) => !open && setClosing(null)}
        />
      )}
      {reversing && (
        <ReversePositionDialog position={reversing} onOpenChange={(open) => !open && setReversing(null)} />
      )}
      {menu && (
        <PositionRowMenu
          x={menu.x}
          y={menu.y}
          onEdit={() => { setEditing(menu.position); setMenu(null); }}
          onReverse={() => { setReversing(menu.position); setMenu(null); }}
          onClose={() => { setClosing({ position: menu.position, initialQty: menu.position.qty }); setMenu(null); }}
          onClosePartial={() => { setClosing({ position: menu.position, initialQty: menu.position.qty / 2 }); setMenu(null); }}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/** Right-click (desktop) / long-press (mobile) trigger for a row's action menu. */
export function useRowMenuTrigger(open: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  // A row can unmount mid-press on its own — a TP/SL or liquidation fill takes
  // the position out of the table — and the pending timer would then fire
  // `open()` on a dead tree, holding the row's props alive until it did.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      open(e.clientX, e.clientY);
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      longPressed.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        longPressed.current = true;
        open(e.clientX, e.clientY);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current || !timer.current) return;
      if (Math.abs(e.clientX - start.current.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - start.current.y) > LONG_PRESS_SLOP) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    },
    onPointerUp: () => {
      if (timer.current) clearTimeout(timer.current);
    },
    onPointerCancel: () => {
      if (timer.current) clearTimeout(timer.current);
    },
  };
}

function PositionRow({
  position, mark, pnlDisplayMode, onEdit, onClose, onReverse, onMenu,
}: {
  position: PaperPosition;
  mark: number;
  pnlDisplayMode: PnlDisplayMode;
  onEdit: () => void;
  onClose: () => void;
  onReverse: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const displaySymbol = paperDisplaySymbol(position);
  const tickSize = useSymbolInfo(displaySymbol).tickSize;
  // Same helper the chart's order-line layer and the mobile card derive their
  // figures from, so the three surfaces can't disagree about one position.
  const { pnl, roe, displayPnl, liquidationUrgent } = positionFiguresAt(
    position,
    mark,
    pnlDisplayMode,
    tickSize,
  );
  const pnlColor = pnl >= 0 ? "text-tv-green" : "text-tv-red";
  const menuTrigger = useRowMenuTrigger(onMenu);

  return (
    <tr
      className="border-b border-tv-border hover:bg-tv-panel-hover"
      {...menuTrigger}
    >
      <td className="px-3 py-1.5 font-semibold">{displaySymbol}</td>
      <td className="px-3 py-1.5">
        <SideChip side={position.side} />
      </td>
      <td className="px-3 py-1.5 font-mono tabular-nums">{position.qty}</td>
      <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(position.entryPrice)}</td>
      <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(mark)}</td>
      <td className="px-3 py-1.5 font-mono tabular-nums">
        {position.liquidationPrice > 0 ? (
          <span className={cn("inline-flex items-center gap-1", liquidationUrgent ? "text-tv-red" : undefined)}>
            {formatPrice(position.liquidationPrice)}
            {liquidationUrgent && (
              <span
                title="Mark is within 10% of the liquidation distance"
                className="inline-flex items-center gap-0.5 rounded bg-tv-red/15 px-1 py-0.5 text-[9px] font-bold text-tv-red"
              >
                <TriangleAlert className="h-2.5 w-2.5" /> Near liq.
              </span>
            )}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-1.5 font-mono tabular-nums">{position.leverage}x</td>
      <td className="px-3 py-1.5 font-mono tabular-nums">
        {position.tp !== null ? (
          <span className="text-tv-green">{formatPrice(position.tp)}</span>
        ) : (
          <span className="text-tv-text-muted">No TP</span>
        )}
      </td>
      <td className="px-3 py-1.5 font-mono tabular-nums">
        {position.sl !== null ? (
          <span className="text-tv-yellow">{formatPrice(position.sl)}</span>
        ) : (
          <span className="text-tv-text-muted">No SL</span>
        )}
      </td>
      <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", pnlColor)}>
        {formatPnlDisplay(displayPnl, pnlDisplayMode)}
      </td>
      <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", roe >= 0 ? "text-tv-green" : "text-tv-red")}>
        {formatPct(roe)}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            title="Edit TP / SL"
            className="rounded p-0.5 text-tv-text-muted hover:bg-tv-bg hover:text-tv-text"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={onReverse}
            title="Reverse position"
            className="rounded p-0.5 text-tv-text-muted hover:bg-tv-bg hover:text-tv-text"
          >
            <ArrowLeftRight className="h-3 w-3" />
          </button>
          <button
            onClick={onClose}
            title="Close position"
            className="rounded p-0.5 text-tv-text-muted hover:bg-tv-red/15 hover:text-tv-red"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function PositionRowMenu({
  x, y, onEdit, onReverse, onClose, onClosePartial, onDismiss,
}: {
  x: number;
  y: number;
  onEdit: () => void;
  onReverse: () => void;
  onClose: () => void;
  onClosePartial: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref so the listener effect can key on `[]`. Callers pass a fresh
  // arrow every render, and their renders are tick-rate — keyed on `onDismiss`
  // this effect swapped two `document` listeners (one capture-phase) on every
  // price tick for as long as the menu stayed open.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) dismiss.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss.current();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: x, top: y }}
      className="z-50 w-48 overflow-hidden rounded-md border border-tv-border bg-tv-panel shadow-xl"
    >
      <button onClick={onEdit} className="block w-full px-3 py-2 text-left text-xs text-tv-text hover:bg-tv-panel-hover">
        Edit TP / SL
      </button>
      <button onClick={onReverse} className="block w-full px-3 py-2 text-left text-xs text-tv-text hover:bg-tv-panel-hover">
        Reverse
      </button>
      <button onClick={onClose} className="block w-full px-3 py-2 text-left text-xs text-tv-red hover:bg-tv-panel-hover">
        Close
      </button>
      <button onClick={onClosePartial} className="block w-full px-3 py-2 text-left text-xs text-tv-red hover:bg-tv-panel-hover">
        Close partial…
      </button>
    </div>,
    document.body,
  );
}

/* ───────────────────────── Close dialog ───────────────────────── */

export function ClosePositionDialog({
  position, initialQty, onOpenChange,
}: { position: PaperPosition; initialQty: number; onOpenChange: (open: boolean) => void }) {
  const closePosition = usePaperTradingStore((s) => s.closePosition);
  const displaySymbol = paperDisplaySymbol(position);
  const [qtyStr, setQtyStr] = useState(String(initialQty));

  const qty = parseFloat(qtyStr);
  // A remainder under the engine's own dust tolerance folds into a full
  // close there already — the UI only needs to keep the typed value inside
  // (0, qty], not duplicate that epsilon logic.
  const valid = isFinite(qty) && qty > 0 && qty <= position.qty * (1 + 1e-9);

  function confirm() {
    if (!valid) return;
    // Read the mark fresh rather than a render-time prop, which can lag
    // behind the store between renders and book the close at a stale price.
    const liveMark = markOf(usePaperTradingStore.getState().marks, position);
    closePosition(position.symbol, liveMark, qty);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Close position — {displaySymbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-tv-text-muted">
            <span>
              <SideChip side={position.side} /> {position.qty} @ {formatPrice(position.entryPrice)}
            </span>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-tv-text-muted">Quantity to close</label>
            <input
              type="number"
              step="any"
              autoFocus
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
            />
            <div className="flex gap-1 pt-1">
              {[0.25, 0.5, 0.75, 1].map((frac) => (
                <button
                  key={frac}
                  onClick={() => setQtyStr(String(position.qty * frac))}
                  className="flex-1 rounded border border-tv-border py-1 text-[10px] text-tv-text-muted hover:border-tv-blue hover:text-tv-text"
                >
                  {frac === 1 ? "100%" : `${frac * 100}%`}
                </button>
              ))}
            </div>
          </div>
          {!valid && (
            <div className="rounded border border-tv-red/40 bg-tv-red/10 px-2 py-1.5 text-[10px] text-tv-red">
              Enter a quantity greater than 0 and up to {position.qty}
            </div>
          )}
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded px-4 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!valid}
            className="rounded bg-tv-red/90 px-4 py-1.5 text-xs font-semibold text-white hover:bg-tv-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-tv-red/90"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Reverse dialog ───────────────────────── */

export function ReversePositionDialog({
  position, onOpenChange,
}: { position: PaperPosition; onOpenChange: (open: boolean) => void }) {
  const reversePosition = usePaperTradingStore((s) => s.reversePosition);
  const displaySymbol = paperDisplaySymbol(position);
  const opposite = position.side === "LONG" ? "Short" : "Long";

  function confirm() {
    const liveMark = markOf(usePaperTradingStore.getState().marks, position);
    reversePosition(position.symbol, liveMark);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Reverse position — {displaySymbol}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-tv-text-muted">
          Closes your <SideChip side={position.side} /> {position.qty} position at the current mark and opens
          an equal-size {opposite} position, same leverage ({position.leverage}x).
        </p>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded px-4 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            className="rounded bg-tv-blue px-4 py-1.5 text-xs font-semibold text-white hover:bg-tv-blue/90"
          >
            Reverse
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Edit position dialog ───────────────────────── */

export function EditPositionDialog({
  position, onOpenChange,
}: { position: PaperPosition; onOpenChange: (open: boolean) => void }) {
  const setBrackets = usePaperTradingStore((s) => s.setBrackets);
  // Just this symbol's mark, not the whole record — `withMark` hands out a
  // fresh identity whenever *any* exposed symbol ticks, which re-rendered the
  // open dialog (and re-ran its validation) for symbols it doesn't show.
  const mark = usePaperTradingStore((s) => s.marks[position.symbol]) ?? position.entryPrice;
  const displaySymbol = paperDisplaySymbol(position);
  const [tp, setTp] = useState(position.tp !== null ? String(position.tp) : "");
  const [sl, setSl] = useState(position.sl !== null ? String(position.sl) : "");

  const tpNum = tp.trim() === "" ? null : parseFloat(tp);
  const slNum = sl.trim() === "" ? null : parseFloat(sl);
  const tpValid = tpNum === null || isFinite(tpNum);
  const slValid = slNum === null || isFinite(slNum);

  function warningAt(referenceMark: number): string | null {
    if (!tpValid || !slValid) return "Enter a valid number, or leave blank to remove";
    return bracketEditReason(position.side, referenceMark, tpNum, slNum);
  }

  const warning = warningAt(mark);

  function save() {
    // Re-validate against the live mark rather than the render-time value —
    // the engine does the same inside `setBrackets`, and a stale prop could
    // let a submit through that the engine would then silently re-clamp.
    const liveMark = markOf(usePaperTradingStore.getState().marks, position);
    // Past the guard above, `warningAt` has already rejected any unparseable
    // input, so both values are a real price or `null` (= remove the bracket).
    if (warningAt(liveMark)) return;
    setBrackets(position.symbol, { tp: tpNum, sl: slNum });
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Edit position — {displaySymbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-tv-text-muted">Take Profit (price)</label>
            <input
              type="number"
              step="any"
              autoFocus
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              placeholder="empty = remove"
              className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-tv-text-muted">Stop Loss (price)</label>
            <input
              type="number"
              step="any"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              placeholder="empty = remove"
              className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
            />
          </div>
          {warning && (
            <div className="rounded border border-tv-yellow/40 bg-tv-yellow/10 px-2 py-1.5 text-[10px] text-tv-yellow">
              {warning}
            </div>
          )}
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded px-4 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={warning !== null}
            className="rounded bg-tv-blue px-4 py-1.5 text-xs font-semibold text-white hover:bg-tv-blue/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-tv-blue"
          >
            Apply
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Resting orders table ───────────────────────── */

function OrdersTable({ orders }: { orders: PaperOrder[] }) {
  const cancelOrder = usePaperTradingStore((s) => s.cancelOrder);

  if (orders.length === 0) {
    return <Stub message="No resting orders" />;
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-tv-border text-left text-[10px] uppercase tracking-wider text-tv-text-muted">
          <th className="px-3 py-1.5">Symbol</th>
          <th className="px-3 py-1.5">Side</th>
          <th className="px-3 py-1.5">Type</th>
          <th className="px-3 py-1.5">Qty</th>
          <th className="px-3 py-1.5">Limit Price</th>
          <th className="px-3 py-1.5">Take Profit</th>
          <th className="px-3 py-1.5">Stop Loss</th>
          <th className="px-3 py-1.5"></th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-b border-tv-border hover:bg-tv-panel-hover">
            <td className="px-3 py-1.5 font-semibold">{paperDisplaySymbol(o)}</td>
            <td className={cn("px-3 py-1.5 font-semibold", o.side === "BUY" ? "text-tv-blue-text" : "text-tv-red")}>
              {o.side === "BUY" ? "Buy" : "Sell"}
            </td>
            <td className="px-3 py-1.5 capitalize">{o.type.toLowerCase()}</td>
            <td className="px-3 py-1.5 font-mono tabular-nums">{o.qty}</td>
            <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(o.price)}</td>
            <td className="px-3 py-1.5 font-mono tabular-nums">
              {o.tp !== null ? formatPrice(o.tp) : "—"}
            </td>
            <td className="px-3 py-1.5 font-mono tabular-nums">
              {o.sl !== null ? formatPrice(o.sl) : "—"}
            </td>
            <td className="px-3 py-1.5">
              <button
                onClick={() => cancelOrder(o.id)}
                title="Cancel order"
                className="rounded p-0.5 text-tv-text-muted hover:bg-tv-red/15 hover:text-tv-red"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ───────────────────────── History table ───────────────────────── */

const REASON_CLASS: Record<PaperTrade["reason"], string> = {
  TP: "text-tv-green",
  SL: "text-tv-yellow",
  LIQUIDATION: "text-tv-red",
  MANUAL: "text-tv-text-muted",
};

function HistoryTable({ trades }: { trades: PaperTrade[] }) {
  if (trades.length === 0) {
    return <Stub message="No closed trades yet" />;
  }

  // Most recent first; `history` is appended in close order, but sorting by
  // `closedAt` is the actual intent rather than relying on array order.
  const sorted = [...trades].sort((a, b) => b.closedAt - a.closedAt);

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-tv-border text-left text-[10px] uppercase tracking-wider text-tv-text-muted">
          <th className="px-3 py-1.5">Symbol</th>
          <th className="px-3 py-1.5">Side</th>
          <th className="px-3 py-1.5">Qty</th>
          <th className="px-3 py-1.5">Entry</th>
          <th className="px-3 py-1.5">Exit</th>
          <th className="px-3 py-1.5">Fees</th>
          <th className="px-3 py-1.5 text-right">Realized P&L</th>
          <th className="px-3 py-1.5 text-right">ROI%</th>
          <th className="px-3 py-1.5">Reason</th>
          <th className="px-3 py-1.5">Duration</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => {
          const pnlColor = t.realizedPnl >= 0 ? "text-tv-green" : "text-tv-red";
          const roi = t.roi * 100;
          return (
            <tr key={t.id} className="border-b border-tv-border hover:bg-tv-panel-hover">
              <td className="px-3 py-1.5 font-semibold">{t.symbol}</td>
              <td className="px-3 py-1.5">
                <SideChip side={t.side} />
              </td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{t.qty}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(t.entryPrice)}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(t.exitPrice)}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{t.fees.toFixed(2)}</td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", pnlColor)}>
                {t.realizedPnl >= 0 ? "+" : ""}
                {t.realizedPnl.toFixed(2)} USDT
              </td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", pnlColor)}>
                {formatPct(roi)}
              </td>
              <td className={cn("px-3 py-1.5 font-semibold", REASON_CLASS[t.reason])}>
                {reasonLabel(t.reason)}
              </td>
              <td className="px-3 py-1.5 font-mono tabular-nums text-tv-text-muted">
                {formatDuration(t.durationMs)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ───────────────────────── Notifications table ───────────────────────── */

function NotificationsTable({ events }: { events: PaperEvent[] }) {
  if (events.length === 0) {
    return <Stub message="No notifications yet" />;
  }

  return (
    <ul className="divide-y divide-tv-border">
      {events.map((e, i) => (
        <li key={i} className="flex items-center gap-2 px-3 py-2 text-[11px]">
          <Bell className={cn("h-3 w-3 shrink-0", PAPER_EVENT_TONE[e.type])} />
          <span className="text-tv-text">{describePaperEvent(e)}</span>
        </li>
      ))}
    </ul>
  );
}
