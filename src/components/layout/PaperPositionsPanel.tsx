"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Pencil, X } from "lucide-react";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { bracketEditReason } from "@/lib/trading/paper-brackets";
import { formatDuration, reasonLabel } from "@/lib/trading/paper-format";
import { totalUnrealizedPnl, unrealizedPnl, positionRoi } from "@/lib/trading/paper-engine";
import type { PaperOrder, PaperPosition, PaperTrade } from "@/lib/trading/paper-engine";

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
 * 7). The mark-driven subscriptions live in `AccountStats`/`PositionsTable`
 * below, which only mount once the panel is expanded onto the relevant tab.
 */

type Tab = "positions" | "orders" | "history";

export function PaperPositionsPanel() {
  const mode = useTradingModeStore((s) => s.mode);
  const account = usePaperTradingStore((s) => s.account);
  const resetAccount = usePaperTradingStore((s) => s.resetAccount);

  const [collapsed, setCollapsed] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [tab, setTab] = useState<Tab>("positions");

  const positions = account.positions;
  const restingOrders = useMemo(
    () => account.orders.filter((o) => o.status === "NEW"),
    [account.orders],
  );

  if (mode !== "paper") return null;

  return (
    <div
      className={cn(
        "flex flex-col border-t border-tv-border bg-tv-panel text-tv-text",
        fullscreen ? "fixed inset-0 z-40" : "",
      )}
      style={fullscreen ? {} : { maxHeight: collapsed ? 32 : "45vh", minHeight: 32 }}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-tv-border text-[11px] font-semibold">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-8 flex-1 items-center gap-2 px-3 transition-colors hover:bg-tv-panel-hover"
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
        </button>
        <span className="flex items-center gap-1 pr-3">
          {!collapsed && (
            <button
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="rounded p-1 text-tv-text-muted hover:bg-tv-bg hover:text-tv-text"
            >
              {fullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
            className="rounded p-1 text-tv-text-muted hover:bg-tv-bg hover:text-tv-text"
          >
            {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </span>
      </div>

      {!collapsed && (
        <>
          <AccountStats
            balance={account.balance}
            positions={positions}
            onReset={resetAccount}
          />

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
          </div>

          <div className="flex-1 overflow-auto">
            {tab === "positions" && <PositionsTable positions={positions} />}
            {tab === "orders" && <OrdersTable orders={restingOrders} />}
            {tab === "history" && <HistoryTable trades={account.history} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── helpers ─── */

/** The two mark-driven figures (unrealized P&L, equity), split out of the
 *  shell so the tick-rate subscriptions only exist while the panel is open. */
function AccountStats({
  balance, positions, onReset,
}: { balance: number; positions: PaperPosition[]; onReset: () => void }) {
  const marks = usePaperTradingStore((s) => s.marks);
  const equity = usePaperTradingStore((s) => s.equity());
  const unrealized = useMemo(() => totalUnrealizedPnl(positions, marks), [positions, marks]);

  return (
    <div className="flex items-center gap-6 border-b border-tv-border px-4 py-2 text-[11px]">
      <Stat label="Balance (USDT)" value={balance.toFixed(2)} />
      <Stat
        label="Unrealized PnL (USDT)"
        value={`${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}`}
        valueClass={unrealized >= 0 ? "text-tv-green" : "text-tv-red"}
      />
      <Stat label="Equity (USDT)" value={equity.toFixed(2)} />
      <span className="ml-auto text-[9px] uppercase tracking-wider text-tv-text-muted">
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
      <span className="text-[9px] uppercase tracking-wider text-tv-text-muted">{label}</span>
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
        "border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors",
        active
          ? "border-tv-blue text-tv-text"
          : "border-transparent text-tv-text-muted hover:text-tv-text",
      )}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── Positions table ───────────────────────── */

function PositionsTable({ positions }: { positions: PaperPosition[] }) {
  // Subscribed here rather than passed down from the shell: this table is the
  // only thing that renders a per-tick mark, and it only exists while the
  // Positions tab is open (holistic review finding 7).
  const marks = usePaperTradingStore((s) => s.marks);
  const closePosition = usePaperTradingStore((s) => s.closePosition);
  const [editing, setEditing] = useState<string | null>(null);

  if (positions.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-tv-text-muted">
        No open positions
      </div>
    );
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-tv-border text-left text-[10px] uppercase tracking-wider text-tv-text-muted">
          <th className="px-3 py-1.5">Symbol</th>
          <th className="px-3 py-1.5">Side</th>
          <th className="px-3 py-1.5">Qty</th>
          <th className="px-3 py-1.5">Avg Entry</th>
          <th className="px-3 py-1.5">Mark</th>
          <th className="px-3 py-1.5">Liq. Price</th>
          <th className="px-3 py-1.5">Leverage</th>
          <th className="px-3 py-1.5">Take Profit</th>
          <th className="px-3 py-1.5">Stop Loss</th>
          <th className="px-3 py-1.5 text-right">Unrealized PnL</th>
          <th className="px-3 py-1.5 text-right">ROI%</th>
          <th className="px-3 py-1.5"></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const mark = marks[p.symbol] ?? p.entryPrice;
          const pnl = unrealizedPnl(p, mark);
          const roi = positionRoi(p, mark) * 100;
          const isLong = p.side === "LONG";
          const pnlColor = pnl >= 0 ? "text-tv-green" : "text-tv-red";
          const displaySymbol = p.feedSymbol ?? p.symbol;
          return (
            <tr key={p.id} className="border-b border-tv-border/50 hover:bg-tv-panel-hover">
              <td className="px-3 py-1.5 font-semibold">{displaySymbol}</td>
              <td className={cn("px-3 py-1.5 font-semibold", isLong ? "text-tv-blue-text" : "text-tv-red")}>
                {isLong ? "Long" : "Short"}
              </td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{p.qty}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(p.entryPrice)}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{formatPrice(mark)}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">
                {p.liquidationPrice > 0 ? formatPrice(p.liquidationPrice) : "—"}
              </td>
              <td className="px-3 py-1.5 font-mono tabular-nums">{p.leverage}x</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">
                {p.tp !== null ? (
                  <span className="text-tv-green">{formatPrice(p.tp)}</span>
                ) : (
                  <span className="text-tv-text-muted">No TP</span>
                )}
              </td>
              <td className="px-3 py-1.5 font-mono tabular-nums">
                {p.sl !== null ? (
                  <span className="text-tv-yellow">{formatPrice(p.sl)}</span>
                ) : (
                  <span className="text-tv-text-muted">No SL</span>
                )}
              </td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", pnlColor)}>
                {pnl >= 0 ? "+" : ""}
                {pnl.toFixed(2)} USDT
              </td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", pnlColor)}>
                {roi >= 0 ? "+" : ""}
                {roi.toFixed(2)}%
              </td>
              <td className="px-3 py-1.5">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditing(p.id)}
                    title="Set TP / SL"
                    className="rounded p-0.5 text-tv-text-muted hover:bg-tv-bg hover:text-tv-text"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Close ${displaySymbol} ${isLong ? "Long" : "Short"} ${p.qty}?`)) {
                        // Read the mark fresh rather than the render-time `mark`
                        // prop, which can lag behind the store between renders
                        // and book the close at a stale price; falls back to
                        // entry price the same way the store's own fallback
                        // would, so a feedless position still closes.
                        const liveMark =
                          usePaperTradingStore.getState().marks[p.symbol] ?? p.entryPrice;
                        closePosition(p.symbol, liveMark);
                      }
                    }}
                    title="Close position (at the current mark)"
                    className="rounded p-0.5 text-tv-text-muted hover:bg-tv-red/15 hover:text-tv-red"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {editing === p.id && (
                  <EditBracketsPopover position={p} mark={mark} onClose={() => setEditing(null)} />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EditBracketsPopover({
  position, mark, onClose,
}: { position: PaperPosition; mark: number; onClose: () => void }) {
  const setBrackets = usePaperTradingStore((s) => s.setBrackets);
  const [tp, setTp] = useState(position.tp !== null ? String(position.tp) : "");
  const [sl, setSl] = useState(position.sl !== null ? String(position.sl) : "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    // Re-validate against the live mark rather than the render-time `mark`
    // prop — the engine does the same inside `setBrackets`, and a stale
    // prop could let a submit through that the engine would then silently
    // re-clamp.
    const liveMark = usePaperTradingStore.getState().marks[position.symbol] ?? position.entryPrice;
    if (warningAt(liveMark)) return;
    setBrackets(position.symbol, {
      tp: tpValid ? tpNum : undefined,
      sl: slValid ? slNum : undefined,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-72 space-y-3 rounded-lg border border-tv-border bg-tv-panel p-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Set TP / SL — {position.feedSymbol ?? position.symbol}</span>
          <button onClick={onClose} className="text-tv-text-muted hover:text-tv-text">
            <X className="h-4 w-4" />
          </button>
        </div>
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
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-tv-text-muted hover:bg-tv-panel-hover"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={warning !== null}
            className="rounded bg-tv-blue px-3 py-1 text-xs font-semibold text-white hover:bg-tv-blue/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-tv-blue"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
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
          <tr key={o.id} className="border-b border-tv-border/50 hover:bg-tv-panel-hover">
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
          const isLong = t.side === "LONG";
          const pnlColor = t.realizedPnl >= 0 ? "text-tv-green" : "text-tv-red";
          const roi = t.roi * 100;
          return (
            <tr key={t.id} className="border-b border-tv-border/50 hover:bg-tv-panel-hover">
              <td className="px-3 py-1.5 font-semibold">{t.symbol}</td>
              <td className={cn("px-3 py-1.5 font-semibold", isLong ? "text-tv-blue-text" : "text-tv-red")}>
                {isLong ? "Long" : "Short"}
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
