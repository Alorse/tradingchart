"use client";

import { useMemo, useState } from "react";
import { OrderPanel } from "@/components/trading/OrderPanel/OrderPanel";
import { PaperOrderPanel } from "@/components/trading/OrderPanel/PaperOrderPanel";
import {
  ClosePositionDialog,
  EditPositionDialog,
  PositionRowMenu,
  ReversePositionDialog,
  SideChip,
  useRowMenuTrigger,
} from "@/components/layout/PaperPositionsPanel";
import { TradeModeToggle } from "@/components/trading/TradeModeToggle";
import { matchTpSl, EditOrderPopover } from "@/components/layout/PositionsPanel";
import { IconButton } from "@/components/mobile/IconButton";
import { useTradingStore } from "@/lib/store/trading-store";
import { useTradingModeStore } from "@/lib/store/trading-mode-store";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Pencil, X } from "lucide-react";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import {
  formatPnlDisplay,
  paperDisplaySymbol,
  positionFiguresAt,
} from "@/lib/trading/paper-position-display";
import type { PnlDisplayMode } from "@/lib/trading/paper-position-display";
import { totalUnrealizedPnl, usedMargin } from "@/lib/trading/paper-engine";
import type { PaperPosition } from "@/lib/trading/paper-engine";
import type { Order } from "@/lib/binance/trading-types";

/**
 * Mobile Trade tab — combined view with the order form on top and the user's
 * positions + open orders below, all in one vertical scroll.
 *
 * Reuses <OrderPanel /> (the existing sidebar form) so trading parity with
 * desktop comes "for free" — including switching to the typed TP/SL editor
 * (PositionEditPanel) in place of the form whenever a position is being
 * edited. The form internally handles credentials and shows the API-key
 * gate when not connected.
 *
 * Gated on `trading-mode-store` the same way desktop's `TradePanel` is: the
 * live order form, live positions/orders and the live-only position-edit
 * panel are all unreachable whenever `mode !== "live"`, so the Paper toggle
 * is what decides whether this screen can place a real order at all. The
 * paper branch reuses `PaperOrderPanel` as-is (no hover-only affordances, so
 * it works on touch unmodified) but renders its own `PaperTradeSection`:
 * desktop's positions *table* doesn't reflow onto a phone width.
 */
export function TradeScreen() {
  const mode = useTradingModeStore((s) => s.mode);
  const apiKey = useTradingStore((s) => s.apiKey);
  const apiSecret = useTradingStore((s) => s.apiSecret);
  const symbol = useChartStore((s) => s.symbol);
  // Account-wide, not scoped to the chart's current symbol — otherwise an
  // open position on a different symbol than the one charted would never
  // show up here (same fix as the desktop PositionsPanel).
  const allPositions = useTradingStore((s) => s.allPositions);
  // Also account-wide since /api/trade/sync fetches orders unscoped — a
  // chart-scoped fetch used to make "Open Orders" silently drop every order
  // for a symbol other than the one charted.
  const orders = useTradingStore((s) => s.orders);
  const balance = useTradingStore((s) => s.balance);
  const closePosition = useTradingStore((s) => s.closePosition);
  const cancelOrder = useTradingStore((s) => s.cancelOrder);
  const openPositionEdit = useTradingStore((s) => s.openPositionEdit);
  const editingPosition = useTradingStore((s) => s.editingPosition);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const connected = !!apiKey && !!apiSecret;

  // No poll of its own: `useTradingSync` (mounted globally in providers.tsx)
  // already refreshes balance / orders / positions and pauses on a hidden tab.
  // A second interval here just doubled the `/api/trade/*` invocations.

  const activePositions = useMemo(
    () => allPositions.filter((p) => p.positionAmt !== 0),
    [allPositions],
  );
  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === "NEW" || o.status === "PARTIALLY_FILLED"),
    [orders],
  );
  const totalEquity = balance.reduce((acc, b) => acc + b.free + b.locked, 0);
  const unrealizedPnL = activePositions.reduce((acc, p) => acc + p.unrealizedProfit, 0);

  // Inverted on purpose (checks "live", not "paper"), matching `TradePanel`:
  // any unrecognized mode must fail closed to the paper branch, never to the
  // one that can place real orders.
  if (mode !== "live") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <TradeModeToggle />
        <div className="flex-1 overflow-y-auto">
          <div className="shrink-0 border-b border-tv-border">
            <PaperOrderPanel key={symbol} />
          </div>
          <PaperTradeSection />
        </div>
      </div>
    );
  }

  // While a position is being edited (typed TP/SL panel replaces the order
  // form), skip the rest of this screen — same "just the panel" behavior
  // the desktop right-click → Modify order flow gets.
  if (editingPosition) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <OrderPanel />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <TradeModeToggle />
      {/* Stats */}
      {connected && (
        <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-tv-border bg-tv-panel px-3 py-2 text-[11px]">
          <Stat label="Equity" value={totalEquity.toFixed(2)} />
          <Stat
            label="uPnL"
            value={unrealizedPnL.toFixed(2)}
            valueClass={unrealizedPnL >= 0 ? "text-tv-green" : "text-tv-red"}
          />
          <Stat label="Open" value={`${activePositions.length} pos · ${activeOrders.length} ord`} />
        </div>
      )}

      {/* Order form */}
      <div className="shrink-0 border-b border-tv-border">
        <OrderPanel />
      </div>

      {/* Positions */}
      {connected && (
        <Section title="Positions" emptyMessage="No open positions">
          {activePositions.map((p) => {
            const isLong = p.positionAmt > 0;
            const { tp, sl } = matchTpSl(p, orders);
            // Positions here span every symbol on the account, so reconstruct
            // a chartable ticker from the bare exchange symbol — trading in
            // this app is perp-only, so `.P` always applies.
            const posSymbol = `${p.symbol}.P`;
            return (
              <div
                key={`${p.symbol}-${p.side}`}
                className="border-b border-tv-border/60 px-3 py-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      {p.symbol}{" "}
                      <span className={cn(
                        "rounded px-1 text-[9px]",
                        isLong ? "bg-tv-blue/15 text-tv-blue-text" : "bg-tv-red/15 text-tv-red",
                      )}>
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-tv-text-muted tabular-nums">
                      {Math.abs(p.positionAmt)} @ {formatPrice(p.entryPrice)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={cn(
                        "font-mono text-xs tabular-nums",
                        p.unrealizedProfit >= 0 ? "text-tv-green" : "text-tv-red",
                      )}>
                        {p.unrealizedProfit >= 0 ? "+" : ""}{p.unrealizedProfit.toFixed(2)}
                      </span>
                      <span className={cn(
                        "font-mono text-[10px] tabular-nums",
                        p.percentage >= 0 ? "text-tv-green" : "text-tv-red",
                      )}>
                        {p.percentage >= 0 ? "+" : ""}{p.percentage.toFixed(2)}%
                      </span>
                    </div>
                    <IconButton
                      onClick={() => openPositionEdit(posSymbol, p)}
                      aria-label="Edit take profit / stop loss"
                      className="text-tv-text-muted active:bg-tv-panel-hover active:text-tv-text"
                    >
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      onClick={() => void closePosition(posSymbol, p)}
                      aria-label="Close position"
                      className="text-tv-text-muted active:bg-tv-red/15 active:text-tv-red"
                    >
                      <X className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {(tp !== null || sl !== null || p.liquidationPrice > 0) && (
                  <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] tabular-nums">
                    {tp !== null && <span className="text-tv-green">TP {formatPrice(tp)}</span>}
                    {sl !== null && <span className="text-tv-yellow">SL {formatPrice(sl)}</span>}
                    {p.liquidationPrice > 0 && (
                      <span className="text-tv-red">Liq {formatPrice(p.liquidationPrice)}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {/* Orders */}
      {connected && (
        <Section title="Open Orders" emptyMessage="No pending orders">
          {activeOrders.map((o) => (
            <div
              key={o.orderId}
              className="flex items-center justify-between border-b border-tv-border/60 px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  {o.symbol}{" "}
                  <span className={cn(
                    "rounded px-1 text-[9px]",
                    o.side === "BUY" ? "bg-tv-blue/15 text-tv-blue-text" : "bg-tv-red/15 text-tv-red",
                  )}>
                    {o.side}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-tv-text-muted tabular-nums">
                  {o.type.replace(/_/g, " ")} · {o.origQty} @{" "}
                  {o.stopPrice ? formatPrice(o.stopPrice) : o.price > 0 ? formatPrice(o.price) : "MKT"}
                  {o.reduceOnly && " · reduce-only"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  onClick={() => setEditingOrder(o)}
                  aria-label="Edit order"
                  className="text-tv-text-muted active:bg-tv-panel-hover active:text-tv-text"
                >
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  onClick={() => void cancelOrder(symbol, o.orderId)}
                  aria-label="Cancel order"
                  className="text-tv-text-muted active:bg-tv-red/15 active:text-tv-red"
                >
                  <X className="size-4" />
                </IconButton>
              </div>
            </div>
          ))}
        </Section>
      )}

      {editingOrder && (
        <EditOrderPopover
          order={editingOrder}
          symbol={symbol}
          onClose={() => setEditingOrder(null)}
        />
      )}
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

function Section({
  title, emptyMessage, children,
}: { title: string; emptyMessage: string; children: React.ReactNode }) {
  const childArr = Array.isArray(children) ? children : [children];
  const empty = childArr.flat().filter(Boolean).length === 0;
  return (
    <section>
      <h3 className="bg-tv-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {title}
      </h3>
      {empty ? (
        <p className="px-3 py-3 text-xs text-tv-text-muted">{emptyMessage}</p>
      ) : (
        <div>{children}</div>
      )}
    </section>
  );
}

/**
 * Paper mode's mobile body: a stats row + the positions/orders lists, in the
 * same shape as the live section above — but the positions render as cards
 * (`PaperPositionCard`) instead of reusing the desktop `PaperPositionsPanel`
 * table wholesale, since a `<table>` doesn't reflow onto a phone width.
 * History/Notifications stay desktop-only for now (not part of this pass).
 */
function PaperTradeSection() {
  const account = usePaperTradingStore((s) => s.account);
  const marks = usePaperTradingStore((s) => s.marks);
  const pnlDisplayMode = usePaperTradingStore((s) => s.pnlDisplayMode);
  const cancelOrder = usePaperTradingStore((s) => s.cancelOrder);

  const restingOrders = useMemo(
    () => account.orders.filter((o) => o.status === "NEW"),
    [account.orders],
  );
  const unrealized = totalUnrealizedPnl(account.positions, marks);
  // `equity()` is defined as exactly this sum, so calling it would walk the
  // positions twice more per tick — and as a selector it ran on every store
  // `set`, not just on render. Same shape as desktop's `AccountSummaryRow`.
  const equity = account.balance + usedMargin(account) + unrealized;

  return (
    <>
      <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-tv-border bg-tv-panel px-3 py-2 text-[11px]">
        <Stat label="Equity" value={equity.toFixed(2)} />
        <Stat
          label="uPnL"
          value={unrealized.toFixed(2)}
          valueClass={unrealized >= 0 ? "text-tv-green" : "text-tv-red"}
        />
        <Stat label="Open" value={`${account.positions.length} pos · ${restingOrders.length} ord`} />
      </div>

      <Section title="Positions" emptyMessage="No open positions">
        {account.positions.map((p) => (
          <PaperPositionCard
            key={p.id}
            position={p}
            mark={marks[p.symbol] ?? p.entryPrice}
            pnlDisplayMode={pnlDisplayMode}
          />
        ))}
      </Section>

      <Section title="Open Orders" emptyMessage="No pending orders">
        {restingOrders.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between border-b border-tv-border/60 px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">
                {paperDisplaySymbol(o)}{" "}
                <span className={cn(
                  "rounded px-1 text-[9px]",
                  o.side === "BUY" ? "bg-tv-blue/15 text-tv-blue-text" : "bg-tv-red/15 text-tv-red",
                )}>
                  {o.side === "BUY" ? "Buy" : "Sell"}
                </span>
              </span>
              <span className="font-mono text-[10px] text-tv-text-muted tabular-nums">
                {o.type} · {o.qty} @ {formatPrice(o.price)}
              </span>
            </div>
            <IconButton
              onClick={() => cancelOrder(o.id)}
              aria-label="Cancel order"
              className="text-tv-text-muted active:bg-tv-red/15 active:text-tv-red"
            >
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
      </Section>
    </>
  );
}

function PaperPositionCard({
  position, mark, pnlDisplayMode,
}: { position: PaperPosition; mark: number; pnlDisplayMode: PnlDisplayMode }) {
  const displaySymbol = paperDisplaySymbol(position);
  const tickSize = useSymbolInfo(displaySymbol).tickSize;
  const figures = positionFiguresAt(position, mark, pnlDisplayMode, tickSize);

  const [editing, setEditing] = useState(false);
  const [closingQty, setClosingQty] = useState<number | null>(null);
  const [reversing, setReversing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuTrigger = useRowMenuTrigger((x, y) => setMenu({ x, y }));

  return (
    <div className="border-b border-tv-border/60 px-3 py-2.5" {...menuTrigger}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            {displaySymbol} <SideChip side={position.side} />
          </span>
          <span className="font-mono text-[10px] text-tv-text-muted tabular-nums">
            {position.qty} @ {formatPrice(position.entryPrice)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end gap-0.5">
            <span className={cn("font-mono text-xs tabular-nums", figures.pnl >= 0 ? "text-tv-green" : "text-tv-red")}>
              {formatPnlDisplay(figures.displayPnl, pnlDisplayMode)}
            </span>
            <span className={cn("font-mono text-[10px] tabular-nums", figures.roe >= 0 ? "text-tv-green" : "text-tv-red")}>
              {figures.roe >= 0 ? "+" : ""}{figures.roe.toFixed(2)}%
            </span>
          </div>
          <IconButton
            onClick={() => setEditing(true)}
            aria-label="Edit take profit / stop loss"
            className="text-tv-text-muted active:bg-tv-panel-hover active:text-tv-text"
          >
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            onClick={() => setClosingQty(position.qty)}
            aria-label="Close position"
            className="text-tv-text-muted active:bg-tv-red/15 active:text-tv-red"
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
      {(position.tp !== null || position.sl !== null || position.liquidationPrice > 0) && (
        <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] tabular-nums">
          {position.tp !== null && <span className="text-tv-green">TP {formatPrice(position.tp)}</span>}
          {position.sl !== null && <span className="text-tv-yellow">SL {formatPrice(position.sl)}</span>}
          {position.liquidationPrice > 0 && (
            <span className={cn(figures.liquidationUrgent ? "font-bold text-tv-red" : "text-tv-red")}>
              Liq {formatPrice(position.liquidationPrice)}
              {figures.liquidationUrgent && " ⚠"}
            </span>
          )}
        </div>
      )}
      {editing && (
        <EditPositionDialog position={position} onOpenChange={(open) => !open && setEditing(false)} />
      )}
      {closingQty !== null && (
        <ClosePositionDialog
          position={position}
          initialQty={closingQty}
          onOpenChange={(open) => !open && setClosingQty(null)}
        />
      )}
      {reversing && (
        <ReversePositionDialog position={position} onOpenChange={(open) => !open && setReversing(false)} />
      )}
      {menu && (
        <PositionRowMenu
          x={menu.x}
          y={menu.y}
          onEdit={() => { setEditing(true); setMenu(null); }}
          onReverse={() => { setReversing(true); setMenu(null); }}
          onClose={() => { setClosingQty(position.qty); setMenu(null); }}
          onClosePartial={() => { setClosingQty(position.qty / 2); setMenu(null); }}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}
