"use client";

import { useEffect, useMemo, useState } from "react";
import { useChartStore } from "@/lib/store/chart-store";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { useBookTicker } from "@/lib/binance/use-book-ticker";
import { getBybitWS } from "@/lib/bybit/ws";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { qtyToSizings, sizingToQty, modeRequiresSl, type SizingCtx } from "@/lib/trading/sizing";
import { isPerp } from "@/lib/binance/rest";
import { paperFeedSource } from "@/lib/trading/paper-feed";
import { getBaseAsset } from "@/components/watchlist/CoinIcon";
import {
  defaultPaperOrderForm,
  invalidBracketReason,
  isPaperOrderReady,
  paperFormToLimitRequest,
  paperFormToMarketRequest,
  type PaperOrderForm,
} from "@/lib/trading/paper-order-form";
import {
  BidAskBar,
  ExitsSection,
  LeverageSlider,
  OrderTypeTabs,
  PriceInput,
  SizingControl,
  SubmitButton,
  nextSizingInput,
} from "./shared";

const PAPER_ORDER_TYPE_TABS: Array<{ key: "MARKET" | "LIMIT"; label: string }> = [
  { key: "MARKET", label: "Market" },
  { key: "LIMIT", label: "Limit" },
];

/**
 * Venue-aware quote for the paper ticket: `useBookTicker` only ever carries
 * Binance data (and now skips subscribing at all for anything else, see its
 * own header comment), so a Bybit-charted or feedless symbol used to leave
 * bid/ask permanently null with no explanation — `submit()` would then just
 * silently no-op on a MARKET order (adversarial review finding 6). Bybit has
 * no separate book-ticker stream (same reasoning as `BuySellOverlay`'s quote),
 * so its last price stands in for both sides.
 */
function usePaperQuote(symbol: string): { bid: number | null; ask: number | null } {
  const [bybitTick, setBybitTick] = useState<{ symbol: string; price: number } | null>(null);
  const source = paperFeedSource(symbol);

  useEffect(() => {
    if (source !== "bybit") return;
    return getBybitWS().subscribeMiniTickers([symbol], (t) => setBybitTick({ symbol, price: t.close }));
  }, [symbol, source]);

  const binanceBook = useBookTicker(symbol);

  if (source === "bybit") {
    if (bybitTick?.symbol !== symbol) return { bid: null, ask: null };
    return { bid: bybitTick.price, ask: bybitTick.price };
  }
  if (source === "binance") return binanceBook;
  return { bid: null, ask: null };
}

/**
 * Paper-mode order panel — same layout as the live `OrderPanel` (built from
 * the same `shared.tsx` pieces), but reading/writing `paper-trading-store`
 * instead of exchange credentials. No API-key gate: paper trading never
 * needs one.
 *
 * Two live features have no paper equivalent, so they're hidden rather than
 * wired to something that would silently no-op:
 *  - Stop / Stop-Limit order types — `paper-engine.ts`'s `PaperOrderType` is
 *    only `MARKET | LIMIT`.
 *  - Time-in-force and Reduce-Only — the engine has no TIF concept (a resting
 *    limit order behaves like GTC until filled or cancelled) and no
 *    reduce-only flag (an opposite-side fill always reduces/closes/flips by
 *    construction, see `applyFill`'s netting logic).
 * Leverage is simpler here than live: the engine takes it directly on the
 * order request, so there's no separate `setLeverage` exchange call to make
 * first.
 */
export function PaperOrderPanel() {
  const symbol = useChartStore((s) => s.symbol);
  const account = usePaperTradingStore((s) => s.account);
  const placeOrder = usePaperTradingStore((s) => s.placeOrder);
  const placeLimitOrder = usePaperTradingStore((s) => s.placeLimitOrder);
  const lastEvents = usePaperTradingStore((s) => s.lastEvents);

  const symInfo = useSymbolInfo(symbol);
  const { bid, ask } = usePaperQuote(symbol);
  const perp = isPerp(symbol);
  const baseAsset = getBaseAsset(symbol);
  const feedSource = paperFeedSource(symbol);

  const [form, setForm] = useState<PaperOrderForm>(() =>
    defaultPaperOrderForm(account.settings.defaultLeverage),
  );
  const patchForm = (patch: Partial<PaperOrderForm>) => setForm((f) => ({ ...f, ...patch }));

  const referencePrice = useMemo(() => {
    if (form.type === "MARKET") return form.side === "BUY" ? ask : bid;
    return parseFloat(form.price) || ask || bid || 0;
  }, [form.type, form.price, form.side, bid, ask]);

  const sl = form.slEnabled && form.sl ? parseFloat(form.sl) : null;

  const ctx: SizingCtx = useMemo(
    () => ({
      entry: referencePrice ?? 0,
      sl,
      // Mirrors `paperFormToMarketRequest`'s leverage cap: the slider is
      // hidden for a non-perp symbol, so the sizing preview shouldn't act
      // like a leverage the actual submission will never apply.
      leverage: perp ? form.leverage : 1,
      balanceUsd: account.balance,
      tickSize: symInfo.tickSize,
      stepSize: symInfo.stepSize,
    }),
    [referencePrice, sl, perp, form.leverage, account.balance, symInfo.tickSize, symInfo.stepSize],
  );

  const qtyNum = parseFloat(form.qty) || 0;
  const derived = useMemo(() => qtyToSizings(qtyNum, ctx), [qtyNum, ctx]);

  // In the risk modes the typed risk is the fixed side, so moving the stop
  // re-sizes the position instead of changing what's at stake — same effect
  // as the live OrderPanel's, so a RISK_USD/RISK_PCT ticket isn't stuck at
  // whatever qty it had when the mode was picked.
  useEffect(() => {
    if (!modeRequiresSl(form.sizingMode) || sl === null) return;
    const risk = parseFloat(form.sizingInput);
    if (!isFinite(risk) || risk <= 0) return;
    const newQty = sizingToQty(form.sizingMode, risk, ctx);
    const formatted = newQty > 0 ? newQty.toFixed(symInfo.quantityPrecision) : "";
    if (formatted !== form.qty) patchForm({ qty: formatted });
  }, [form.sizingMode, form.sizingInput, form.qty, sl, ctx, symInfo.quantityPrecision]);

  const lastReject = lastEvents.find((e) => e.type === "reject");

  // Blocks submission (and explains why) instead of leaving `submit()` to
  // silently no-op on a feedless symbol (finding 6) or leaving a wrong-side
  // TP/SL to be dropped by the engine with no feedback (finding 7).
  const blockedReason =
    feedSource === null
      ? "No live feed for this symbol in paper mode"
      : invalidBracketReason(form, referencePrice ?? 0);

  function submit() {
    if (!isPaperOrderReady(form) || blockedReason !== null) return;
    if (form.type === "MARKET") {
      const price = form.side === "BUY" ? ask : bid;
      if (!price) return;
      placeOrder(paperFormToMarketRequest(form, symbol), price);
    } else {
      placeLimitOrder(paperFormToLimitRequest(form, symbol));
    }
  }

  const cleanSymForSummary = symbol.replace(/\.P$/, "");
  const priceLabel = `${form.qty || "0"} ${cleanSymForSummary} ${form.type === "LIMIT" ? `@ ${form.price || "—"} LIMIT` : form.type}`;

  return (
    <div className="flex h-full flex-col overflow-hidden text-tv-text">
      <PaperPanelHeader symbol={symbol} freeBalance={account.balance} />

      <BidAskBar
        bid={bid}
        ask={ask}
        side={form.side}
        onPickSide={(side) => patchForm({ side })}
      />

      <OrderTypeTabs
        value={form.type}
        tabs={PAPER_ORDER_TYPE_TABS}
        onChange={(t) => patchForm({ type: t })}
      />

      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
        {form.type === "LIMIT" && (
          <PriceInput
            value={form.price}
            onChange={(v) => patchForm({ price: v })}
            placeholder={referencePrice ? referencePrice.toFixed(symInfo.pricePrecision) : "0.0"}
            onSnapToBidAsk={() => {
              const target = form.side === "BUY" ? bid : ask;
              if (target) patchForm({ price: target.toFixed(symInfo.pricePrecision) });
            }}
            label="Price"
            ticksLabel={ask ? `${form.side === "BUY" ? "Bid" : "Ask"} ${(form.side === "BUY" ? bid : ask)?.toFixed(symInfo.pricePrecision) ?? "—"}` : null}
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
            patchForm({
              sizingMode: mode,
              sizingInput: nextSizingInput(qtyNum, mode, ctx),
            });
            if (modeRequiresSl(mode) && !form.slEnabled) {
              patchForm({ slEnabled: true });
            }
          }}
          onChangeInput={(raw) => {
            const value = parseFloat(raw);
            if (isFinite(value) && value > 0) {
              const newQty = sizingToQty(form.sizingMode, value, ctx);
              patchForm({
                sizingInput: raw,
                qty: newQty > 0 ? newQty.toFixed(symInfo.quantityPrecision) : "",
              });
            } else {
              patchForm({ sizingInput: raw, qty: "" });
            }
          }}
        />

        <ExitsSection
          fields={form}
          tickSize={symInfo.tickSize}
          pricePrecision={symInfo.pricePrecision}
          qtyNum={qtyNum}
          referencePrice={referencePrice ?? 0}
          onTp={(patch) => patchForm(patch)}
          onSl={(patch) => patchForm(patch)}
        />

        {perp && (
          <LeverageSlider leverage={form.leverage} onChange={(n) => patchForm({ leverage: n })} />
        )}

        {lastReject && (
          <div className="rounded border border-tv-red/40 bg-tv-red/10 px-2 py-1.5 text-[10px] text-tv-red">
            {lastReject.message}
          </div>
        )}
      </div>

      <SubmitButton
        side={form.side}
        qty={form.qty}
        priceLabel={priceLabel}
        isLoading={false}
        blockedReason={blockedReason}
        onSubmit={submit}
      />
    </div>
  );
}

function PaperPanelHeader({ symbol, freeBalance }: { symbol: string; freeBalance: number }) {
  return (
    <div className="flex items-center justify-between border-b border-tv-border bg-tv-panel px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        <span>{symbol}</span>
        <span className="rounded bg-tv-yellow/20 px-1 py-0.5 text-[9px] font-bold text-tv-yellow">
          PAPER
        </span>
      </div>
      <span className="font-mono text-[11px] tabular-nums text-tv-text-muted">
        ${freeBalance.toFixed(2)} free
      </span>
    </div>
  );
}
