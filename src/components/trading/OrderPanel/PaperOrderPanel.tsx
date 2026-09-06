"use client";

import { useCallback, useState } from "react";
import { useChartStore } from "@/lib/store/chart-store";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { useQuote } from "@/lib/trading/quote";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { isPerp } from "@/lib/binance/rest";
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
  SizingControl,
  SubmitButton,
  TicketPriceInput,
  orderSummaryLabel,
  useOrderTicket,
} from "./shared";

const PAPER_ORDER_TYPE_TABS: Array<{ key: "MARKET" | "LIMIT"; label: string }> = [
  { key: "MARKET", label: "Market" },
  { key: "LIMIT", label: "Limit" },
];

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
  // Only the free balance is rendered/sized off here, so subscribing the whole
  // account would re-render the ticket on every fill, cancel and bracket edit.
  const balance = usePaperTradingStore((s) => s.account.balance);
  const placeOrder = usePaperTradingStore((s) => s.placeOrder);
  const placeLimitOrder = usePaperTradingStore((s) => s.placeLimitOrder);
  const lastEvents = usePaperTradingStore((s) => s.lastEvents);

  const symInfo = useSymbolInfo(symbol);
  const { bid, ask, source: feedSource } = useQuote(symbol);
  const perp = isPerp(symbol);
  const baseAsset = getBaseAsset(symbol);

  const [form, setForm] = useState<PaperOrderForm>(() =>
    defaultPaperOrderForm(usePaperTradingStore.getState().account.settings.defaultLeverage),
  );
  // Stable so `useOrderTicket`'s risk effect can depend on it.
  const patchForm = useCallback(
    (patch: Partial<PaperOrderForm>) => setForm((f) => ({ ...f, ...patch })),
    [],
  );

  const { referencePrice, qtyNum, derived, sizingHandlers } = useOrderTicket({
    form,
    patch: patchForm,
    bid,
    ask,
    balanceUsd: balance,
    // Mirrors `paperFormToMarketRequest`'s leverage cap: the slider is hidden
    // for a non-perp symbol, so the sizing preview shouldn't act like a
    // leverage the actual submission will never apply.
    leverage: perp ? form.leverage : 1,
    symInfo,
  });

  const lastReject = lastEvents.find((e) => e.type === "reject");

  // Blocks submission and says why, instead of leaving `submit()` to silently
  // no-op: on a feedless symbol, on a wrong-side TP/SL the engine would drop,
  // or — for a MARKET order, which fills at the live quote — while the symbol
  // has a feed but the socket hasn't delivered its first tick yet. A LIMIT
  // order carries its own price and needs no quote.
  //
  // `referencePrice` is the quote a MARKET order fills at: `useOrderTicket`
  // already derives it as `side === "BUY" ? ask : bid` for that form type, and
  // re-deriving it here would be a second expression that has to agree with
  // the one driving the sizing preview and bracket validation.
  function blockedReasonFor(): string | null {
    if (feedSource === null) return "No live feed for this symbol in paper mode";
    if (form.type === "MARKET" && !referencePrice) return "Waiting for a live quote…";
    return invalidBracketReason(form, referencePrice ?? 0);
  }
  const blockedReason = blockedReasonFor();

  function submit() {
    if (!isPaperOrderReady(form) || blockedReason !== null) return;
    if (form.type === "MARKET") {
      // Non-null whenever `blockedReason` is null, per the guard above.
      if (referencePrice) placeOrder(paperFormToMarketRequest(form, symbol), referencePrice);
    } else {
      placeLimitOrder(paperFormToLimitRequest(form, symbol));
    }
  }

  const priceLabel = orderSummaryLabel(form, symbol);

  return (
    <div className="flex h-full flex-col overflow-hidden text-tv-text">
      <PaperPanelHeader symbol={symbol} freeBalance={balance} />

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
          <TicketPriceInput
            value={form.price}
            side={form.side}
            bid={bid}
            ask={ask}
            referencePrice={referencePrice}
            pricePrecision={symInfo.pricePrecision}
            onChange={(v) => patchForm({ price: v })}
          />
        )}

        <SizingControl
          mode={form.sizingMode}
          input={form.sizingInput}
          derived={derived}
          baseAsset={baseAsset}
          {...sizingHandlers}
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
