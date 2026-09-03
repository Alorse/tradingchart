"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, KeyRound, RefreshCw, X } from "lucide-react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useBookTicker } from "@/lib/binance/use-book-ticker";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { tradeGate } from "@/lib/trading/exchange-gate";
import {
  qtyToSizings,
  sizingToQty,
  rrRatio,
  modeRequiresSl,
  ticksBetween,
  pnlAtExit,
  slInputToPrice,
  slPriceToInput,
  type SizingCtx,
  type SlCtx,
} from "@/lib/trading/sizing";
import { isPerp } from "@/lib/binance/rest";
import { getBaseAsset } from "@/components/watchlist/CoinIcon";
import { cn } from "@/lib/utils";
import type { Position, SizingMode, SlMode, TimeInForce } from "@/lib/binance/trading-types";
import { ApiKeyDialog } from "../ApiKeyDialog";

const SIZING_LABELS: Record<SizingMode, string> = {
  AMOUNT: "Amount",
  MARGIN_USD: "Margin USD",
  PCT_BALANCE: "% balance",
  RISK_USD: "Risk, USD",
  RISK_PCT: "Risk, % balance",
};

const SL_MODE_LABELS: Record<SlMode, string> = {
  PRICE: "price",
  PCT_PRICE: "% price",
};

const SL_MODE_UNITS: Record<SlMode, string> = {
  PRICE: "",
  PCT_PRICE: "%",
};

const SL_MODE_HINTS: Record<SlMode, string> = {
  PRICE: "Stop-loss price.",
  PCT_PRICE: "Distance from the entry as a percentage of price.",
};

/** Fixed-decimal string without trailing zeros — keeps derived inputs typable. */
function trimNum(n: number, decimals: number): string {
  return String(parseFloat(n.toFixed(decimals)));
}

/**
 * Floating menu anchored under `anchorRef`. Rendered in a portal with fixed
 * positioning: the panel body scrolls (`overflow-y-auto`), which clips
 * absolutely-positioned children, so a menu opening near the bottom would be
 * cut off. Closes on outside click, Escape, or scroll/resize.
 */
function FloatingMenu({
  open, onClose, anchorRef, children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 4, width: r.width });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchorRef.current?.contains(t)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Capture phase so the menu closes even where a child stops propagation.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    // A fixed menu can't follow the panel, so dismiss rather than drift.
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !rect || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: rect.left, top: rect.top, minWidth: rect.width }}
      className="z-50 overflow-hidden rounded-md border border-tv-border bg-tv-panel shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

const TIF_OPTIONS: TimeInForce[] = ["GTC", "IOC", "FOK", "GTX"];

const TIF_LABELS: Record<TimeInForce, string> = {
  GTC: "Good-Till-Canceled",
  IOC: "Immediate-Or-Cancel",
  FOK: "Fill-Or-Kill",
  GTX: "Post Only (GTX)",
};

export function OrderPanel() {
  const symbol = useChartStore((s) => s.symbol);
  const apiKey = useTradingStore((s) => s.apiKey);
  const apiSecret = useTradingStore((s) => s.apiSecret);
  const exchange = useTradingStore((s) => s.exchange);
  const isConnected = useTradingStore((s) => s.isConnected);
  const balance = useTradingStore((s) => s.balance);
  const form = useTradingStore((s) => s.form);
  const updateForm = useTradingStore((s) => s.updateForm);
  const placeOrder = useTradingStore((s) => s.placeOrder);
  const setLeverage = useTradingStore((s) => s.setLeverage);
  const isLoading = useTradingStore((s) => s.isLoading);
  const lastError = useTradingStore((s) => s.lastError);
  const syncAccount = useTradingStore((s) => s.syncAccount);
  const editingPosition = useTradingStore((s) => s.editingPosition);

  // Lifted to trading-store so mobile screens can open it too.
  const keyDialogOpen = useTradingStore((s) => s.apiKeyDialogOpen);
  const setKeyDialogOpen = useTradingStore((s) => s.setApiKeyDialogOpen);

  const symInfo = useSymbolInfo(symbol);
  const { bid, ask } = useBookTicker(symbol);
  const perp = isPerp(symbol);
  const baseAsset = getBaseAsset(symbol);
  // Account data comes from the connected exchange; the chart may be on
  // another venue. Blocks submission instead of filling on the wrong book.
  const gate = tradeGate(symbol, exchange);

  // Refresh on mount + symbol change. One batched request rather than three
  // separate ones — `useTradingSync` keeps this fresh afterwards.
  useEffect(() => {
    if (!apiKey || !apiSecret) return;
    void syncAccount(symbol);
  }, [apiKey, apiSecret, symbol, syncAccount]);

  // Quote balance (USDT free)
  const balanceUsd = useMemo(() => {
    const usdt = balance.find((b) => b.asset === "USDT");
    return usdt ? usdt.free : 0;
  }, [balance]);

  // Best price for the active form type
  const referencePrice = useMemo(() => {
    if (form.type === "MARKET") {
      return form.side === "BUY" ? ask : bid;
    }
    return parseFloat(form.price) || ask || bid || 0;
  }, [form.type, form.price, form.side, bid, ask]);

  const sl = form.slEnabled && form.sl ? parseFloat(form.sl) : null;
  const tp = form.tpEnabled && form.tp ? parseFloat(form.tp) : null;

  const ctx: SizingCtx = useMemo(
    () => ({
      entry: referencePrice ?? 0,
      sl,
      leverage: form.leverage,
      balanceUsd,
      tickSize: symInfo.tickSize,
      stepSize: symInfo.stepSize,
    }),
    [referencePrice, sl, form.leverage, balanceUsd, symInfo.tickSize, symInfo.stepSize],
  );

  // Derived sizing values from canonical qty
  const qtyNum = parseFloat(form.qty) || 0;
  const derived = useMemo(() => qtyToSizings(qtyNum, ctx), [qtyNum, ctx]);

  // Risk/reward — only meaningful when both SL and TP are set
  const rr = useMemo(
    () => rrRatio(referencePrice ?? 0, sl, tp),
    [referencePrice, sl, tp],
  );

  // In the risk modes the typed risk is the fixed side, so moving the stop (or
  // the entry) re-sizes the position instead of changing what's at stake.
  // `ctx` carries the stop, so this reacts to chart drags too; writing only on
  // a real change keeps it from looping.
  useEffect(() => {
    if (!modeRequiresSl(form.sizingMode) || sl === null) return;
    const risk = parseFloat(form.sizingInput);
    if (!isFinite(risk) || risk <= 0) return;
    const newQty = sizingToQty(form.sizingMode, risk, ctx);
    const formatted = newQty > 0 ? newQty.toFixed(symInfo.quantityPrecision) : "";
    if (formatted !== form.qty) updateForm({ qty: formatted });
  }, [
    form.sizingMode, form.sizingInput, form.qty, sl, ctx,
    symInfo.quantityPrecision, updateForm,
  ]);

  if (!apiKey || !apiSecret) {
    return (
      <>
        <ConnectGate onConnect={() => setKeyDialogOpen(true)} />
        {keyDialogOpen && <ApiKeyDialog onClose={() => setKeyDialogOpen(false)} />}
      </>
    );
  }

  // Right-clicking a position's SL/TP line on the chart opens this typed
  // editor here instead of the normal order form — an alternative to
  // dragging the line when you want an exact price.
  if (editingPosition) {
    return <PositionEditPanel symbol={editingPosition.symbol} position={editingPosition.position} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden text-tv-text">
      <PanelHeader symbol={symbol} testnet={useTradingStore.getState().testnet}
        connected={isConnected} onSettings={() => setKeyDialogOpen(true)} />

      <BidAskBar
        bid={bid}
        ask={ask}
        side={form.side}
        onPickSide={(side) => updateForm({ side })}
      />

      <OrderTypeTabs
        value={form.type}
        onChange={(t) => updateForm({ type: t })}
      />

      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
        {form.type !== "MARKET" && (
          <PriceInput
            value={form.price}
            onChange={(v) => updateForm({ price: v })}
            placeholder={referencePrice ? referencePrice.toFixed(symInfo.pricePrecision) : "0.0"}
            onSnapToBidAsk={() => {
              const target = form.side === "BUY" ? bid : ask;
              if (target) updateForm({ price: target.toFixed(symInfo.pricePrecision) });
            }}
            label="Price"
            ticksLabel={ask ? `${form.side === "BUY" ? "Bid" : "Ask"} ${(form.side === "BUY" ? bid : ask)?.toFixed(symInfo.pricePrecision) ?? "—"}` : null}
          />
        )}

        {(form.type === "STOP_LIMIT" || form.type === "STOP_MARKET") && (
          <PriceInput
            value={form.stopPrice}
            onChange={(v) => updateForm({ stopPrice: v })}
            placeholder={referencePrice ? referencePrice.toFixed(symInfo.pricePrecision) : "0.0"}
            label="Stop / Trigger price"
          />
        )}

        <SizingControl
          mode={form.sizingMode}
          input={form.sizingInput}
          qtyNum={qtyNum}
          derived={derived}
          ctx={ctx}
          baseAsset={baseAsset}
          onChangeMode={(mode) => {
            // Recompute the visible input from canonical qty so it stays consistent.
            const next = qtyToSizings(qtyNum, ctx);
            updateForm({
              sizingMode: mode,
              sizingInput: formatForMode(next[mode], mode),
            });
            // Force SL on if mode requires it.
            if (modeRequiresSl(mode) && !form.slEnabled) {
              updateForm({ slEnabled: true });
            }
          }}
          onChangeInput={(raw) => {
            const value = parseFloat(raw);
            if (isFinite(value) && value > 0) {
              const newQty = sizingToQty(form.sizingMode, value, ctx);
              updateForm({
                sizingInput: raw,
                qty: newQty > 0 ? newQty.toFixed(symInfo.quantityPrecision) : "",
              });
            } else {
              updateForm({ sizingInput: raw, qty: "" });
            }
          }}
        />

        <ExitsSection
          form={form}
          tickSize={symInfo.tickSize}
          pricePrecision={symInfo.pricePrecision}
          qtyNum={qtyNum}
          rr={rr}
          referencePrice={referencePrice ?? 0}
          balanceUsd={balanceUsd}
          onPatch={updateForm}
        />

        <ExtraSettings
          tif={form.timeInForce}
          reduceOnly={form.reduceOnly}
          leverage={form.leverage}
          perp={perp}
          onTif={(v) => updateForm({ timeInForce: v })}
          onReduceOnly={(v) => updateForm({ reduceOnly: v })}
          onLeverage={(n) => void setLeverage(symbol, n)}
        />

        {lastError && (
          <div className="rounded border border-tv-red/40 bg-tv-red/10 px-2 py-1.5 text-[10px] text-tv-red">
            {lastError}
          </div>
        )}

      </div>

      <SubmitButton
        symbol={symbol}
        side={form.side}
        type={form.type}
        qty={form.qty}
        price={form.price}
        isLoading={isLoading}
        blockedReason={gate.ok ? null : gate.reason}
        onSubmit={() => placeOrder(symbol)}
      />

      {keyDialogOpen && <ApiKeyDialog onClose={() => setKeyDialogOpen(false)} />}
    </div>
  );
}

/**
 * Typed TP/SL editor for an already-open position, shown in place of the
 * order form. Opened by right-clicking the position's SL/TP line on the
 * chart (`OrderLinesLayer`'s context menu → "Modify order…") — an
 * alternative to dragging the line when an exact price is easier to type.
 * Confirm goes through the same `setPositionTpSl()` the drag flow uses, so
 * Bybit still gets its native position stop and Binance its reduceOnly
 * orders (see CLAUDE.md's "TP/SL attachment" note).
 */
function PositionEditPanel({ symbol, position }: { symbol: string; position: Position }) {
  const closePositionEdit = useTradingStore((s) => s.closePositionEdit);
  const setPositionTpSl = useTradingStore((s) => s.setPositionTpSl);
  const symInfo = useSymbolInfo(symbol);
  const isLong = position.positionAmt > 0;
  const qty = Math.abs(position.positionAmt);

  const [tpEnabled, setTpEnabled] = useState(!!position.takeProfit && position.takeProfit > 0);
  const [slEnabled, setSlEnabled] = useState(!!position.stopLoss && position.stopLoss > 0);
  const [tp, setTp] = useState(position.takeProfit ? String(position.takeProfit) : "");
  const [sl, setSl] = useState(position.stopLoss ? String(position.stopLoss) : "");
  const [saving, setSaving] = useState(false);

  const tpNum = parseFloat(tp);
  const slNum = parseFloat(sl);
  const tpTicks = tp && isFinite(tpNum) ? ticksBetween(position.entryPrice, tpNum, symInfo.tickSize) : 0;
  const slTicks = sl && isFinite(slNum) ? ticksBetween(position.entryPrice, slNum, symInfo.tickSize) : 0;

  async function confirm() {
    setSaving(true);
    // Toggle off, or an emptied field, means "clear" — matches the ×-chip
    // remove behavior on the chart line and PositionsPanel's edit popover.
    const tpVal = tpEnabled ? (tp.trim() === "" ? null : tpNum) : null;
    const slVal = slEnabled ? (sl.trim() === "" ? null : slNum) : null;
    await setPositionTpSl(symbol, position, {
      tp: tpVal === null || isFinite(tpVal) ? tpVal : undefined,
      sl: slVal === null || isFinite(slVal) ? slVal : undefined,
    });
    setSaving(false);
    closePositionEdit();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden text-tv-text">
      <div className="flex items-center justify-between border-b border-tv-border bg-tv-panel px-3 py-2">
        <span className="text-[11px] font-semibold">{position.symbol}.P</span>
        <button
          onClick={closePositionEdit}
          className="rounded p-1 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-4">
        <div className={cn("text-xs font-semibold", isLong ? "text-tv-blue" : "text-tv-red")}>
          {isLong ? "Long" : "Short"} {qty} @ {position.entryPrice.toFixed(symInfo.pricePrecision)}
        </div>

        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-tv-text-muted">Exits</span>

          <div className="space-y-1">
            <label className="flex items-center justify-between">
              <span className="text-[10px] text-tv-text">Take profit, price</span>
              <Switch checked={tpEnabled} onChange={setTpEnabled} />
            </label>
            {tpEnabled && (
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <input
                  type="number"
                  step="any"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                  placeholder={position.entryPrice.toFixed(symInfo.pricePrecision)}
                  className="rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
                />
                <span className="self-center text-[10px] text-tv-text-muted">
                  {tp ? `${Math.abs(tpTicks)} ticks` : ""}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="flex items-center justify-between">
              <span className="text-[10px] text-tv-text">Stop loss, price</span>
              <Switch checked={slEnabled} onChange={setSlEnabled} />
            </label>
            {slEnabled && (
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <input
                  type="number"
                  step="any"
                  value={sl}
                  onChange={(e) => setSl(e.target.value)}
                  placeholder={position.entryPrice.toFixed(symInfo.pricePrecision)}
                  className="rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
                />
                <span className="self-center text-[10px] text-tv-text-muted">
                  {sl ? `${Math.abs(slTicks)} ticks` : ""}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <span className="text-tv-text-muted">Trade value</span>
          <span className="font-mono tabular-nums">{position.notional.toFixed(2)} USD</span>
        </div>
      </div>

      <div className="flex gap-2 border-t border-tv-border p-3">
        <button
          onClick={closePositionEdit}
          className="flex-1 rounded border border-tv-border py-2 text-xs font-semibold text-tv-text hover:bg-tv-panel-hover"
        >
          Discard
        </button>
        <button
          onClick={confirm}
          disabled={saving}
          className="flex-1 rounded bg-tv-blue py-2 text-xs font-semibold text-white hover:bg-tv-blue/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

function formatForMode(n: number, mode: SizingMode): string {
  if (!isFinite(n) || n <= 0) return "";
  if (mode === "AMOUNT") return n.toFixed(6).replace(/\.?0+$/, "");
  if (mode === "PCT_BALANCE" || mode === "RISK_PCT") return n.toFixed(2);
  return n.toFixed(2);
}

/* ───────────────────────── sub-components ───────────────────────── */

function ConnectGate({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <KeyRound className="h-8 w-8 text-tv-text-muted" />
      <p className="text-xs text-tv-text-muted">
        Connect your Binance API to place orders directly from the chart.
      </p>
      <button
        onClick={onConnect}
        className="rounded bg-tv-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-tv-blue/90"
      >
        Connect API
      </button>
    </div>
  );
}

function PanelHeader({
  symbol, testnet, connected, onSettings,
}: { symbol: string; testnet: boolean; connected: boolean; onSettings: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-tv-border bg-tv-panel px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        <span>{symbol}</span>
        <span className={cn(
          "rounded px-1 py-0.5 text-[9px] font-bold",
          testnet ? "bg-tv-yellow/20 text-tv-yellow" : "bg-tv-green/20 text-tv-green",
        )}>
          {testnet ? "TEST" : "LIVE"}
        </span>
        {connected && <span className="h-1.5 w-1.5 rounded-full bg-tv-green" />}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onSettings}
          title="API credentials"
          className="rounded p-1 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function BidAskBar({
  bid, ask, side, onPickSide,
}: { bid: number | null; ask: number | null; side: "BUY" | "SELL"; onPickSide: (s: "BUY" | "SELL") => void }) {
  return (
    <div className="grid grid-cols-2 gap-px border-b border-tv-border bg-tv-border">
      <button
        onClick={() => onPickSide("SELL")}
        className={cn(
          "flex flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors",
          side === "SELL" ? "bg-tv-red/20" : "bg-tv-panel hover:bg-tv-panel-hover",
        )}
      >
        <span className="text-[9px] uppercase tracking-wider text-tv-red">Sell</span>
        <span className="font-mono text-sm font-semibold text-tv-red tabular-nums">
          {bid ? bid.toFixed(2) : "—"}
        </span>
      </button>
      <button
        onClick={() => onPickSide("BUY")}
        className={cn(
          "flex flex-col items-end gap-0.5 px-3 py-2 text-right transition-colors",
          side === "BUY" ? "bg-tv-blue/20" : "bg-tv-panel hover:bg-tv-panel-hover",
        )}
      >
        <span className="text-[9px] uppercase tracking-wider text-tv-blue">Buy</span>
        <span className="font-mono text-sm font-semibold text-tv-blue tabular-nums">
          {ask ? ask.toFixed(2) : "—"}
        </span>
      </button>
    </div>
  );
}

function OrderTypeTabs({
  value, onChange,
}: { value: string; onChange: (t: "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT") => void }) {
  const tabs: Array<{ key: "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT"; label: string }> = [
    { key: "MARKET", label: "Market" },
    { key: "LIMIT", label: "Limit" },
    { key: "STOP_MARKET", label: "Stop" },
    { key: "STOP_LIMIT", label: "Stop Limit" },
  ];
  return (
    <div className="flex border-b border-tv-border bg-tv-panel">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex-1 border-b-2 px-2 py-1.5 text-[11px] font-medium transition-colors",
            value === t.key
              ? "border-tv-blue text-tv-text"
              : "border-transparent text-tv-text-muted hover:text-tv-text",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PriceInput({
  value, onChange, placeholder, label, ticksLabel, onSnapToBidAsk,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  ticksLabel?: string | null;
  onSnapToBidAsk?: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-tv-text-muted">{label}</span>
        {ticksLabel && <span className="text-[10px] text-tv-text-muted">{ticksLabel}</span>}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs text-tv-text tabular-nums outline-none focus:border-tv-blue"
        />
        {onSnapToBidAsk && (
          <button
            onClick={onSnapToBidAsk}
            title="Use bid/ask"
            className="rounded p-1.5 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function SizingControl({
  mode, input, qtyNum, derived, ctx, baseAsset, onChangeMode, onChangeInput,
}: {
  mode: SizingMode;
  input: string;
  qtyNum: number;
  derived: Record<SizingMode, number>;
  ctx: SizingCtx;
  /** Base asset of the current symbol, shown as the Amount unit. */
  baseAsset: string;
  onChangeMode: (m: SizingMode) => void;
  onChangeInput: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  void qtyNum;
  void ctx;

  function suffix(m: SizingMode): string {
    if (m === "AMOUNT") return baseAsset;
    if (m === "MARGIN_USD") return "USD";
    if (m === "RISK_USD") return "USD";
    return "%";
  }

  return (
    <div ref={anchorRef} className="space-y-1">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-tv-text-muted hover:text-tv-text"
        >
          {mode === "AMOUNT" ? `Amount (${baseAsset})` : SIZING_LABELS[mode]}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>
      <div className="relative">
        <input
          type="number"
          step="any"
          value={input}
          onChange={(e) => onChangeInput(e.target.value)}
          placeholder="0"
          className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 pr-10 font-mono text-xs text-tv-text tabular-nums outline-none focus:border-tv-blue"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-tv-text-muted">
          {suffix(mode)}
        </span>
      </div>
      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}>
        {(Object.keys(SIZING_LABELS) as SizingMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { onChangeMode(m); setOpen(false); }}
            className={cn(
              "flex w-full items-center justify-between gap-4 px-2.5 py-1.5 text-[10px]",
              m === mode
                ? "bg-tv-blue/15 text-tv-text"
                : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            <span className="whitespace-nowrap">
              {m === "AMOUNT" ? `Amount (${baseAsset})` : SIZING_LABELS[m]}
            </span>
            <span className="font-mono tabular-nums">
              {derived[m] > 0 ? derived[m].toFixed(m === "AMOUNT" ? 6 : 2) : "—"}
            </span>
          </button>
        ))}
      </FloatingMenu>
    </div>
  );
}

function ExitsSection({
  form, tickSize, pricePrecision, qtyNum, rr, referencePrice, balanceUsd, onPatch,
}: {
  form: ReturnType<typeof useTradingStore.getState>["form"];
  tickSize: number;
  pricePrecision: number;
  qtyNum: number;
  rr: number;
  referencePrice: number;
  balanceUsd: number;
  onPatch: (p: Partial<typeof form>) => void;
}) {
  const [open, setOpen] = useState(true);
  const [slMenuOpen, setSlMenuOpen] = useState(false);
  const slAnchorRef = useRef<HTMLDivElement>(null);
  /** Raw text while the SL field is being typed in; null = show the derived
   *  value, so a stop dragged on the chart flows straight back in here. */
  const [slDraft, setSlDraft] = useState<string | null>(null);

  const slCtx: SlCtx = { entry: referencePrice, side: form.side };
  const slPrice = form.sl ? parseFloat(form.sl) : NaN;
  const slDerived = slPriceToInput(form.slMode, slPrice, slCtx);
  const slValue = slDraft ?? (slDerived > 0 ? trimNum(slDerived, form.slMode === "PRICE" ? pricePrecision : 2) : "");

  // Signed by direction, so a stop placed past the entry (which locks in a
  // gain rather than capping a loss) reads as the profit it is, and a target
  // on the wrong side of the entry reads as the loss it is.
  const tpUsd = form.tpEnabled && form.tp && qtyNum > 0
    ? pnlAtExit(referencePrice, parseFloat(form.tp), qtyNum, form.side)
    : 0;
  const slUsd = form.slEnabled && form.sl && qtyNum > 0
    ? pnlAtExit(referencePrice, parseFloat(form.sl), qtyNum, form.side)
    : 0;
  const tpTicks = form.tp ? ticksBetween(referencePrice, parseFloat(form.tp), tickSize) : 0;

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[10px] uppercase tracking-wider text-tv-text-muted hover:text-tv-text"
      >
        <span>Exits</span>
        <span className="flex items-center gap-1">
          {rr > 0 && (
            <span className="text-tv-text-muted">Risk / Reward {rr.toFixed(2)}</span>
          )}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="flex items-center justify-between">
              <span className="text-[10px] text-tv-text">Take profit, price</span>
              <Switch checked={form.tpEnabled} onChange={(v) => onPatch({ tpEnabled: v })} />
            </label>
            {form.tpEnabled && (
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <input
                  type="number"
                  step="any"
                  value={form.tp}
                  onChange={(e) => onPatch({ tp: e.target.value })}
                  placeholder={referencePrice > 0 ? referencePrice.toFixed(pricePrecision) : "0.0"}
                  className="rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
                />
                <span className="self-center text-[10px] text-tv-text-muted">
                  {form.tp ? `${Math.abs(tpTicks)} ticks` : ""}
                </span>
              </div>
            )}
            {form.tpEnabled && tpUsd !== 0 && (
              <div className={cn("text-right text-[10px]", tpUsd > 0 ? "text-tv-green" : "text-tv-red")}>
                {tpUsd > 0 ? "+" : "−"}{Math.abs(tpUsd).toFixed(2)} USD
              </div>
            )}
          </div>

          <div ref={slAnchorRef} className="space-y-1">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSlMenuOpen((o) => !o)}
                className="flex items-center gap-1 text-[10px] text-tv-text hover:text-tv-blue"
              >
                Stop loss, {SL_MODE_LABELS[form.slMode]}
                {slMenuOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              <Switch checked={form.slEnabled} onChange={(v) => onPatch({ slEnabled: v })} />
            </div>
            <FloatingMenu
              open={slMenuOpen}
              onClose={() => setSlMenuOpen(false)}
              anchorRef={slAnchorRef}
            >
              {(Object.keys(SL_MODE_LABELS) as SlMode[]).map((m) => (
                <button
                  key={m}
                  title={SL_MODE_HINTS[m]}
                  onClick={() => {
                    setSlDraft(null);
                    onPatch({ slMode: m, slEnabled: true });
                    setSlMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-2.5 py-1.5 text-[10px]",
                    m === form.slMode
                      ? "bg-tv-blue/15 text-tv-text"
                      : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
                  )}
                >
                  <span className="whitespace-nowrap">{SL_MODE_LABELS[m]}</span>
                  <span className="font-mono tabular-nums">
                    {slPriceToInput(m, slPrice, slCtx) > 0
                      ? trimNum(slPriceToInput(m, slPrice, slCtx), m === "PRICE" ? pricePrecision : 2)
                      : "—"}
                  </span>
                </button>
              ))}
            </FloatingMenu>
            {form.slEnabled && (
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={slValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSlDraft(raw);
                      const parsed = parseFloat(raw);
                      // Always store the canonical PRICE, whatever unit was typed.
                      const price = slInputToPrice(form.slMode, parsed, slCtx);
                      onPatch({ sl: isFinite(price) ? price.toFixed(pricePrecision) : "" });
                    }}
                    onBlur={() => setSlDraft(null)}
                    placeholder={referencePrice > 0 ? referencePrice.toFixed(pricePrecision) : "0.0"}
                    className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 pr-10 font-mono text-xs tabular-nums focus:border-tv-blue"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-tv-text-muted">
                    {SL_MODE_UNITS[form.slMode]}
                  </span>
                </div>
                <span
                  className={cn(
                    "self-center text-[10px]",
                    slUsd > 0 ? "text-tv-green" : "text-tv-text-muted",
                  )}
                >
                  {slUsd !== 0
                    ? `${slUsd > 0 ? "+" : "−"}${Math.abs(slUsd).toFixed(2)} USD`
                    : ""}
                </span>
              </div>
            )}
            {/* When the field isn't the price itself, still show where the stop lands. */}
            {form.slEnabled && form.slMode !== "PRICE" && slPrice > 0 && (
              <div className="text-right text-[10px] text-tv-text-muted">
                Stop at {slPrice.toFixed(pricePrecision)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExtraSettings({
  tif, reduceOnly, leverage, perp, onTif, onReduceOnly, onLeverage,
}: {
  tif: TimeInForce;
  reduceOnly: boolean;
  leverage: number;
  perp: boolean;
  onTif: (v: TimeInForce) => void;
  onReduceOnly: (v: boolean) => void;
  onLeverage: (n: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function commitLeverage(n: number) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onLeverage(n), 400);
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[10px] uppercase tracking-wider text-tv-text-muted hover:text-tv-text"
      >
        <span>Extra settings</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-[10px] text-tv-text-muted">Time in force</span>
            <select
              value={tif}
              onChange={(e) => onTif(e.target.value as TimeInForce)}
              className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 text-xs text-tv-text focus:border-tv-blue"
            >
              {TIF_OPTIONS.map((t) => (
                <option key={t} value={t}>{TIF_LABELS[t]}</option>
              ))}
            </select>
          </div>
          {perp && (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-tv-text">
                <input
                  type="checkbox"
                  checked={reduceOnly}
                  onChange={(e) => onReduceOnly(e.target.checked)}
                  className="h-3.5 w-3.5 accent-tv-blue"
                />
                Reduce-Only
              </label>
              <div className="space-y-1">
                <span className="text-[10px] text-tv-text-muted">Leverage</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={125}
                    value={leverage}
                    onChange={(e) => commitLeverage(parseInt(e.target.value, 10))}
                    className="flex-1 accent-tv-blue"
                  />
                  <span className="w-12 text-right font-mono text-xs tabular-nums">
                    x{leverage}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SubmitButton({
  symbol, side, type, qty, price, isLoading, blockedReason, onSubmit,
}: {
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  qty: string;
  price: string;
  isLoading: boolean;
  /** Set when the chart's venue doesn't match the connected account, in which
   *  case the order must not be submitted at all. */
  blockedReason: string | null;
  onSubmit: () => void;
}) {
  const cleanSym = symbol.replace(/\.P$/, "");
  const summary = blockedReason
    ? blockedReason
    : `${qty || "0"} ${cleanSym} ${type === "LIMIT" ? `@ ${price || "—"} LIMIT` : type}`;
  const disabled = isLoading || !qty || blockedReason !== null;
  return (
    <button
      onClick={onSubmit}
      disabled={disabled}
      title={blockedReason ?? undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 border-t border-tv-border px-3 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50",
        blockedReason
          ? "bg-tv-text-muted"
          : side === "BUY" ? "bg-tv-blue hover:bg-tv-blue/90" : "bg-tv-red hover:bg-tv-red/90",
      )}
    >
      <span>
        {blockedReason ? "Unavailable" : isLoading ? "Submitting…" : side === "BUY" ? "Buy" : "Sell"}
      </span>
      <span className="text-[10px] font-normal opacity-90">{summary}</span>
    </button>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // Explicit pixel sizing keeps the dot strictly inside the track regardless
  // of Tailwind preset (v3/v4 differ in how spacing scales map to translate).
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ width: 30, height: 16 }}
      className={cn(
        "relative inline-block shrink-0 cursor-pointer rounded-full transition-colors",
        checked ? "bg-tv-blue" : "bg-tv-border",
      )}
    >
      <span
        style={{
          width: 12,
          height: 12,
          top: 2,
          left: checked ? 16 : 2,
        }}
        className="absolute rounded-full bg-white shadow transition-all duration-150"
      />
    </button>
  );
}

