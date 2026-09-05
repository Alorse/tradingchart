"use client";

import { useEffect, useRef, useState } from "react";
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
import { formatPrice } from "@/lib/format";
import { bracketEditReason } from "@/lib/trading/paper-brackets";
import { describePaperEvent, formatDuration, reasonLabel } from "@/lib/trading/paper-format";
import {
  formatPnlDisplay,
  isLiquidationUrgent,
  pnlDisplayValue,
  PNL_DISPLAY_MODES,
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
 * nothing on screen that could show the new number (holistic review finding
 * 7). The mark-driven subscriptions live in `AccountSummaryRow`/`PositionsTable`
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

  const positions = account.positions;
  const restingOrders = account.orders.filter((o) => o.status === "NEW");

  if (mode !== "paper") return null;

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
            <TabBtn active={tab === "positions"} onClick={() => setTab("positions")}>
              Positions {positions.length > 0 && <Badge n={positions.length} />}
            </TabBtn>
            <TabBtn active={tab === "orders"} onClick={() => setTab("orders")}>
              Orders {restingOrders.length > 0 && <Badge n={restingOrders.length} />}
            </TabBtn>
            <TabBtn active={tab === "history"} onClick={() => setTab("history")}>
              History {account.history.length > 0 && <Badge n={account.history.length} />}
            </TabBtn>
            <TabBtn active={tab === "notifications"} onClick={() => setTab("notifications")}>
              <Bell className="h-3 w-3" /> {notifications.length > 0 && <Badge n={notifications.length} />}
            </TabBtn>
          </div>

          <div className="flex-1 overflow-auto">
            {tab === "positions" && <PositionsTable positions={positions} />}
            {tab === "orders" && <OrdersTable orders={restingOrders} />}
            {tab === "history" && <HistoryTable trades={account.history} />}
            {tab === "notifications" && <NotificationsTable events={notifications} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── helpers ─── */

/** The mark-driven figures making up the always-visible summary row, split
 *  out of the shell so the tick-rate subscriptions only exist while the
 *  panel is open (holistic review finding 7). */
function AccountSummaryRow({
  account, onReset,
}: { account: PaperAccount; onReset: () => void }) {
  const marks = usePaperTradingStore((s) => s.marks);
  const equity = usePaperTradingStore((s) => s.equity());
  const unrealized = totalUnrealizedPnl(account.positions, marks);
  const marginUsed = usedMargin(account);
  const realized = account.history.reduce((s, t) => s + t.realizedPnl, 0);

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

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-tv-text-muted">{label}</span>
      <span className={cn("font-mono text-xs tabular-nums", valueClass ?? "text-tv-text")}>
        {value}
      </span>
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return <span className="ml-1 rounded bg-tv-blue/20 px-1 text-[9px] font-bold text-tv-blue-text">{n}</span>;
}

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors",
        active
          ? "border-tv-blue text-tv-text"
          : "border-transparent text-tv-text-muted hover:text-tv-text",
      )}
    >
      {children}
    </button>
  );
}

function SideChip({ side }: { side: "LONG" | "SHORT" }) {
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
  // Positions tab is open (holistic review finding 7).
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
    return (
      <div className="flex h-32 items-center justify-center text-xs text-tv-text-muted">
        No open positions
      </div>
    );
  }

  const rows = sortRows(
    positions.map((position) => {
      const mark = marks[position.symbol] ?? position.entryPrice;
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
            {m === "MONEY" ? "Money" : m === "TICKS" ? "Ticks" : "%"}
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
          {rows.map(({ position, mark, pnl, roe }) => (
            <PositionRow
              key={position.id}
              position={position}
              mark={mark}
              pnl={pnl}
              roe={roe}
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
function useRowMenuTrigger(open: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

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
  position, mark, pnl, roe, pnlDisplayMode, onEdit, onClose, onReverse, onMenu,
}: {
  position: PaperPosition;
  mark: number;
  pnl: number;
  roe: number;
  pnlDisplayMode: PnlDisplayMode;
  onEdit: () => void;
  onClose: () => void;
  onReverse: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const displaySymbol = position.feedSymbol ?? position.symbol;
  const tickSize = useSymbolInfo(displaySymbol).tickSize;
  const displayPnl = pnlDisplayValue(position, mark, pnlDisplayMode, tickSize);
  const pnlColor = pnl >= 0 ? "text-tv-green" : "text-tv-red";
  const liquidationUrgent = isLiquidationUrgent(position, mark);
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
        {roe >= 0 ? "+" : ""}
        {roe.toFixed(2)}%
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

function PositionRowMenu({
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

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onDismiss();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

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
  const displaySymbol = position.feedSymbol ?? position.symbol;
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
    const liveMark = usePaperTradingStore.getState().marks[position.symbol] ?? position.entryPrice;
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
  const displaySymbol = position.feedSymbol ?? position.symbol;
  const opposite = position.side === "LONG" ? "Short" : "Long";

  function confirm() {
    const liveMark = usePaperTradingStore.getState().marks[position.symbol] ?? position.entryPrice;
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
  const marks = usePaperTradingStore((s) => s.marks);
  const mark = marks[position.symbol] ?? position.entryPrice;
  const displaySymbol = position.feedSymbol ?? position.symbol;
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
    const liveMark = usePaperTradingStore.getState().marks[position.symbol] ?? position.entryPrice;
    if (warningAt(liveMark)) return;
    setBrackets(position.symbol, {
      tp: tpValid ? tpNum : undefined,
      sl: slValid ? slNum : undefined,
    });
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
    return (
      <div className="flex h-32 items-center justify-center text-xs text-tv-text-muted">
        No resting orders
      </div>
    );
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
            <td className="px-3 py-1.5 font-semibold">{o.feedSymbol ?? o.symbol}</td>
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
    return (
      <div className="flex h-32 items-center justify-center text-xs text-tv-text-muted">
        No closed trades yet
      </div>
    );
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
                {roi >= 0 ? "+" : ""}
                {roi.toFixed(2)}%
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
    return (
      <div className="flex h-32 items-center justify-center text-xs text-tv-text-muted">
        No notifications yet
      </div>
    );
  }

  return (
    <ul className="divide-y divide-tv-border">
      {events.map((e, i) => (
        <li key={i} className="flex items-center gap-2 px-3 py-2 text-[11px]">
          <Bell
            className={cn(
              "h-3 w-3 shrink-0",
              e.type === "reject" ? "text-tv-red" : e.type === "close" ? "text-tv-green" : "text-tv-blue-text",
            )}
          />
          <span className="text-tv-text">{describePaperEvent(e)}</span>
        </li>
      ))}
    </ul>
  );
}
