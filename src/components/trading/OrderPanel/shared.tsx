"use client";

/**
 * Presentational building blocks shared by the live `OrderPanel` and the
 * paper-mode `PaperOrderPanel` — everything here is prop-driven, with no
 * store reads of its own, so either panel can wire it to its own account.
 * Layout/markup must stay byte-for-byte identical between the two modes so
 * muscle memory carries over (issue #6): change a visual here, not by
 * forking it into two copies.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import {
  qtyToSizings,
  rrRatio,
  ticksBetween,
  pnlAtExit,
  slInputToPrice,
  slPriceToInput,
  type SizingCtx,
  type SlCtx,
} from "@/lib/trading/sizing";
import { cn } from "@/lib/utils";
import type { OrderSide, SizingMode, SlMode } from "@/lib/binance/trading-types";

export const SIZING_LABELS: Record<SizingMode, string> = {
  AMOUNT: "Amount",
  MARGIN_USD: "Margin USD",
  PCT_BALANCE: "% balance",
  RISK_USD: "Risk, USD",
  RISK_PCT: "Risk, % balance",
};

export const SL_MODE_LABELS: Record<SlMode, string> = {
  PRICE: "price",
  PCT_PRICE: "% price",
};

export const SL_MODE_UNITS: Record<SlMode, string> = {
  PRICE: "",
  PCT_PRICE: "%",
};

export const SL_MODE_HINTS: Record<SlMode, string> = {
  PRICE: "Stop-loss price.",
  PCT_PRICE: "Distance from the entry as a percentage of price.",
};

/** Fixed-decimal string without trailing zeros — keeps derived inputs typable. */
export function trimNum(n: number, decimals: number): string {
  return String(parseFloat(n.toFixed(decimals)));
}

export function formatForMode(n: number, mode: SizingMode): string {
  if (!isFinite(n) || n <= 0) return "";
  if (mode === "AMOUNT") return n.toFixed(6).replace(/\.?0+$/, "");
  if (mode === "PCT_BALANCE" || mode === "RISK_PCT") return n.toFixed(2);
  return n.toFixed(2);
}

/**
 * Floating menu anchored under `anchorRef`. Rendered in a portal with fixed
 * positioning: the panel body scrolls (`overflow-y-auto`), which clips
 * absolutely-positioned children, so a menu opening near the bottom would be
 * cut off. Closes on outside click, Escape, or scroll/resize.
 */
export function FloatingMenu({
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

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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

export function BidAskBar({
  bid, ask, side, onPickSide,
}: { bid: number | null; ask: number | null; side: OrderSide; onPickSide: (s: OrderSide) => void }) {
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

export function OrderTypeTabs<T extends string>({
  value, tabs, onChange,
}: { value: T; tabs: Array<{ key: T; label: string }>; onChange: (t: T) => void }) {
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

export function PriceInput({
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

export function SizingControl({
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

export interface ExitsFields {
  side: OrderSide;
  tpEnabled: boolean;
  tp: string;
  slEnabled: boolean;
  sl: string;
  slMode: SlMode;
}

/**
 * TP/SL brackets, shared verbatim by both panels. Takes the handful of
 * primitive fields it needs rather than a whole form object + patcher, so it
 * has no dependency on either store's form shape.
 */
export function ExitsSection({
  fields, tickSize, pricePrecision, qtyNum, referencePrice, onTp, onSl,
}: {
  fields: ExitsFields;
  tickSize: number;
  pricePrecision: number;
  qtyNum: number;
  referencePrice: number;
  onTp: (patch: { tpEnabled?: boolean; tp?: string }) => void;
  onSl: (patch: { slEnabled?: boolean; sl?: string; slMode?: SlMode }) => void;
}) {
  const [open, setOpen] = useState(true);
  const [slMenuOpen, setSlMenuOpen] = useState(false);
  const slAnchorRef = useRef<HTMLDivElement>(null);
  /** Raw text while the SL field is being typed in; null = show the derived
   *  value, so a stop dragged on the chart flows straight back in here. */
  const [slDraft, setSlDraft] = useState<string | null>(null);

  const { side, tpEnabled, tp, slEnabled, sl, slMode } = fields;
  const slCtx: SlCtx = { entry: referencePrice, side };
  const slPriceNum = sl ? parseFloat(sl) : NaN;
  const slDerived = slPriceToInput(slMode, slPriceNum, slCtx);
  const slValue = slDraft ?? (slDerived > 0 ? trimNum(slDerived, slMode === "PRICE" ? pricePrecision : 2) : "");

  const rr = rrRatio(referencePrice, slEnabled && sl ? parseFloat(sl) : null, tpEnabled && tp ? parseFloat(tp) : null);

  // Signed by direction, so a stop placed past the entry (which locks in a
  // gain rather than capping a loss) reads as the profit it is, and a target
  // on the wrong side of the entry reads as the loss it is.
  const tpUsd = tpEnabled && tp && qtyNum > 0
    ? pnlAtExit(referencePrice, parseFloat(tp), qtyNum, side)
    : 0;
  const slUsd = slEnabled && sl && qtyNum > 0
    ? pnlAtExit(referencePrice, parseFloat(sl), qtyNum, side)
    : 0;
  const tpTicks = tp ? ticksBetween(referencePrice, parseFloat(tp), tickSize) : 0;

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
              <Switch checked={tpEnabled} onChange={(v) => onTp({ tpEnabled: v })} />
            </label>
            {tpEnabled && (
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <input
                  type="number"
                  step="any"
                  value={tp}
                  onChange={(e) => onTp({ tp: e.target.value })}
                  placeholder={referencePrice > 0 ? referencePrice.toFixed(pricePrecision) : "0.0"}
                  className="rounded border border-tv-border bg-tv-bg px-2 py-1.5 font-mono text-xs tabular-nums focus:border-tv-blue"
                />
                <span className="self-center text-[10px] text-tv-text-muted">
                  {tp ? `${Math.abs(tpTicks)} ticks` : ""}
                </span>
              </div>
            )}
            {tpEnabled && tpUsd !== 0 && (
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
                Stop loss, {SL_MODE_LABELS[slMode]}
                {slMenuOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              <Switch checked={slEnabled} onChange={(v) => onSl({ slEnabled: v })} />
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
                    onSl({ slMode: m, slEnabled: true });
                    setSlMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-2.5 py-1.5 text-[10px]",
                    m === slMode
                      ? "bg-tv-blue/15 text-tv-text"
                      : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
                  )}
                >
                  <span className="whitespace-nowrap">{SL_MODE_LABELS[m]}</span>
                  <span className="font-mono tabular-nums">
                    {slPriceToInput(m, slPriceNum, slCtx) > 0
                      ? trimNum(slPriceToInput(m, slPriceNum, slCtx), m === "PRICE" ? pricePrecision : 2)
                      : "—"}
                  </span>
                </button>
              ))}
            </FloatingMenu>
            {slEnabled && (
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
                      const price = slInputToPrice(slMode, parsed, slCtx);
                      onSl({ sl: isFinite(price) ? price.toFixed(pricePrecision) : "" });
                    }}
                    onBlur={() => setSlDraft(null)}
                    placeholder={referencePrice > 0 ? referencePrice.toFixed(pricePrecision) : "0.0"}
                    className="w-full rounded border border-tv-border bg-tv-bg px-2 py-1.5 pr-10 font-mono text-xs tabular-nums focus:border-tv-blue"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-tv-text-muted">
                    {SL_MODE_UNITS[slMode]}
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
            {slEnabled && slMode !== "PRICE" && slPriceNum > 0 && (
              <div className="text-right text-[10px] text-tv-text-muted">
                Stop at {slPriceNum.toFixed(pricePrecision)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LeverageSlider({
  leverage, onChange,
}: { leverage: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-tv-text-muted">Leverage</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={1}
          max={125}
          value={leverage}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="flex-1 accent-tv-blue"
        />
        <span className="w-12 text-right font-mono text-xs tabular-nums">
          x{leverage}
        </span>
      </div>
    </div>
  );
}

export function SubmitButton({
  side, qty, priceLabel, isLoading, blockedReason, submitLabel, onSubmit,
}: {
  side: OrderSide;
  qty: string;
  /** Trailing summary text, e.g. "0.5 BTCUSDT @ 30000 LIMIT". */
  priceLabel: string;
  isLoading: boolean;
  /** Set when the order can't be submitted at all — shows instead of the
   *  side/qty summary and disables the button. */
  blockedReason: string | null;
  /** Overrides the "Buy"/"Sell"/"Submitting…" label, e.g. while loading. */
  submitLabel?: string;
  onSubmit: () => void;
}) {
  const summary = blockedReason ? blockedReason : priceLabel;
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
        {submitLabel ?? (blockedReason ? "Unavailable" : isLoading ? "Submitting…" : side === "BUY" ? "Buy" : "Sell")}
      </span>
      <span className="text-[10px] font-normal opacity-90">{summary}</span>
    </button>
  );
}

/** Recomputes the visible sizing-mode input from canonical qty, used both on
 *  a mode switch (so the new unit shows the equivalent value) and is shared
 *  so both panels format it identically. */
export function nextSizingInput(qtyNum: number, mode: SizingMode, ctx: SizingCtx): string {
  const next = qtyToSizings(qtyNum, ctx);
  return formatForMode(next[mode], mode);
}
