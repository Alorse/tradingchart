"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, KeyRound, X } from "lucide-react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useBookTicker } from "@/lib/binance/use-book-ticker";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { tradeGate } from "@/lib/trading/exchange-gate";
import {
  qtyToSizings,
  sizingToQty,
  modeRequiresSl,
  ticksBetween,
  type SizingCtx,
} from "@/lib/trading/sizing";
import { isPerp } from "@/lib/binance/rest";
import { getBaseAsset } from "@/components/watchlist/CoinIcon";
import { cn } from "@/lib/utils";
import type { Position, TimeInForce } from "@/lib/binance/trading-types";
import { ApiKeyDialog } from "../ApiKeyDialog";
import {
  BidAskBar,
  ExitsSection,
  LeverageSlider,
  OrderTypeTabs,
  PriceInput,
  SizingControl,
  SubmitButton,
  Switch,
  nextSizingInput,
} from "./shared";

const TIF_OPTIONS: TimeInForce[] = ["GTC", "IOC", "FOK", "GTX"];

const TIF_LABELS: Record<TimeInForce, string> = {
  GTC: "Good-Till-Canceled",
  IOC: "Immediate-Or-Cancel",
  FOK: "Fill-Or-Kill",
  GTX: "Post Only (GTX)",
};

const ORDER_TYPE_TABS: Array<{ key: "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT"; label: string }> = [
  { key: "MARKET", label: "Market" },
  { key: "LIMIT", label: "Limit" },
  { key: "STOP_MARKET", label: "Stop" },
  { key: "STOP_LIMIT", label: "Stop Limit" },
];

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

  const cleanSymForSummary = symbol.replace(/\.P$/, "");
  const priceLabel = `${form.qty || "0"} ${cleanSymForSummary} ${form.type === "LIMIT" ? `@ ${form.price || "—"} LIMIT` : form.type}`;

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
        value={form.type as "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT"}
        tabs={ORDER_TYPE_TABS}
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
            updateForm({
              sizingMode: mode,
              sizingInput: nextSizingInput(qtyNum, mode, ctx),
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
          fields={form}
          tickSize={symInfo.tickSize}
          pricePrecision={symInfo.pricePrecision}
          qtyNum={qtyNum}
          referencePrice={referencePrice ?? 0}
          onTp={(patch) => updateForm(patch)}
          onSl={(patch) => updateForm(patch)}
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
        side={form.side}
        qty={form.qty}
        priceLabel={priceLabel}
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
              <LeverageSlider leverage={leverage} onChange={commitLeverage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
