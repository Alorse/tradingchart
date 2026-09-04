"use client";

import { useEffect, useState, useMemo } from "react";
import { Search, ChevronDown, Sparkles, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchExchangeSymbols } from "@/lib/binance/rest";
import {
  isSyntheticExpression,
  extractSymbols,
} from "@/lib/binance/synthetic";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";
import type { SymbolInfo } from "@/lib/binance/types";
import {
  CATALOG,
  getDynamicEntries,
  type Category,
  type SourceKind,
  type SymbolEntry,
} from "@/lib/symbols/catalog";
import { SymbolIcon } from "@/components/symbols/SymbolIcon";

/** A row in the search list, tagged with the venue its data comes from. */
interface SearchRow {
  /** Ticker the chart is set to when picked. */
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  /** Display label + filter key for the exchange/data source. */
  exchange: string;
  /** Raw source kind — drives the venue mark on the row's icon. */
  source: SourceKind;
  category?: Category;
  /**
   * Long-form name shown under the ticker ("Apple Inc.", "SOL / USDT
   * Perpetual · Bybit"). Always present so every row has a subtitle, and it
   * is matched by the search box too — typing "APPLE" finds AAPL.
   */
  description: string;
}

/** Display label for each data source. Doubles as the filter chip label. */
const SOURCE_LABEL: Record<SourceKind, string> = {
  binance: "Binance",
  bybit: "Bybit",
  yahoo: "Yahoo",
  fred: "FRED",
  coingecko: "CoinGecko",
};

/**
 * Venues that get a filter chip, in display order. Yahoo and CoinGecko are
 * deliberately absent: their symbols stay searchable and pickable under "All",
 * they just don't earn a chip in a row this narrow.
 */
const EXCHANGE_ORDER = ["Binance", "Bybit", "FRED"];

function entryToRow(e: SymbolEntry): SearchRow {
  // Bybit perps carry the ".P" ticker + coin base so search-by-coin works;
  // other catalog entries key on their ticker.
  const isBybit = e.source === "bybit";
  return {
    symbol: e.ticker,
    baseAsset: isBybit ? e.providerSymbol.replace(/USDT$/, "") : e.ticker,
    // The exchange badge already says "Bybit", so the quote stays generic.
    quoteAsset: isBybit ? "USDT (Perp)" : e.category,
    exchange: SOURCE_LABEL[e.source],
    source: e.source,
    category: e.category,
    description: e.description,
  };
}

/** Binance's own exchangeInfo feed has no source tag — everything is Binance. */
function binanceToRow(s: SymbolInfo): SearchRow {
  // The feed already marks perps by appending "(Perp)" to the quote asset;
  // spell that out in the subtitle instead of repeating the decoration.
  const perp = s.quoteAsset.includes("(Perp)");
  const quote = s.quoteAsset.replace(" (Perp)", "");
  return {
    symbol: s.symbol,
    baseAsset: s.baseAsset,
    quoteAsset: s.quoteAsset,
    exchange: "Binance",
    source: "binance",
    category: "Crypto",
    description: `${s.baseAsset} / ${quote} ${perp ? "Perpetual" : "Spot"} · Binance`,
  };
}

/** Static catalog entries presented as rows so they slot into the list UI. */
const CATALOG_AS_ROWS: SearchRow[] = CATALOG.map(entryToRow);

export function SymbolSelector({ noTrigger = false }: { noTrigger?: boolean } = {}) {
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const open = useChartStore((s) => s.symbolDialogOpen);
  const setOpen = useChartStore((s) => s.setSymbolDialogOpen);
  const symbolDialogInitialQuery = useChartStore((s) => s.symbolDialogInitialQuery);
  const setSymbolDialogInitialQuery = useChartStore((s) => s.setSymbolDialogInitialQuery);
  const setSymbolDialogInsertAfterId = useChartStore((s) => s.setSymbolDialogInsertAfterId);
  const activeWatchlistId = useChartStore((s) => s.activeWatchlistId);
  const watchlists = useChartStore((s) => s.watchlists);
  const addSymbolToWatchlist = useChartStore((s) => s.addSymbolToWatchlist);
  const activeWatchlistSymbols = useMemo(() => {
    const w = watchlists.find((x) => x.id === activeWatchlistId);
    return new Set(
      (w?.items ?? [])
        .filter((i) => i.type === "symbol")
        .map((i) => i.value),
    );
  }, [watchlists, activeWatchlistId]);

  const [query, setQuery] = useState("");
  const [allSymbols, setAllSymbols] = useState<SearchRow[]>([]);
  /** Active exchange filter chip; null = All. */
  const [exchangeFilter, setExchangeFilter] = useState<string | null>(null);

  useEffect(() => {
    if (open && symbolDialogInitialQuery) {
      setQuery(symbolDialogInitialQuery);
      setSymbolDialogInitialQuery("");
    }
  }, [open, symbolDialogInitialQuery, setSymbolDialogInitialQuery]);

  useEffect(() => {
    if (open && allSymbols.length === 0) {
      // Bybit perps registered at app load (useBybitSymbols).
      const bybit = getDynamicEntries().map(entryToRow);
      fetchExchangeSymbols()
        .then((binance) =>
          setAllSymbols([...CATALOG_AS_ROWS, ...binance.map(binanceToRow), ...bybit]),
        )
        .catch((err) => {
          console.error(err);
          // Even if Binance fails, the catalog + Bybit symbols stay selectable.
          setAllSymbols([...CATALOG_AS_ROWS, ...bybit]);
        });
    }
  }, [open, allSymbols.length]);

  /** Exchanges actually present in the loaded list, in a stable display order. */
  const exchanges = useMemo(() => {
    const present = new Set(allSymbols.map((s) => s.exchange));
    return EXCHANGE_ORDER.filter((e) => present.has(e));
  }, [allSymbols]);

  const trimmed = query.trim().toUpperCase();
  const isExpression = isSyntheticExpression(trimmed);
  const expressionValid = useMemo(() => {
    if (!isExpression) return false;
    const tokens = extractSymbols(trimmed);
    if (tokens.length === 0) return false;
    const known = new Set(allSymbols.map((s) => s.symbol));
    return tokens.every((t) => known.has(t));
  }, [isExpression, trimmed, allSymbols]);

  const filtered = useMemo(() => {
    if (isExpression) return [];
    const byExchange = exchangeFilter
      ? allSymbols.filter((s) => s.exchange === exchangeFilter)
      : allSymbols;
    if (!trimmed) return byExchange.slice(0, 100);
    return byExchange
      .filter(
        (s) =>
          s.symbol.includes(trimmed) ||
          s.baseAsset.includes(trimmed) ||
          s.quoteAsset.includes(trimmed) ||
          // The long name is searchable too, so "APPLE" finds AAPL and
          // "DOMINANCE" finds the .D series.
          s.description.toUpperCase().includes(trimmed),
      )
      .slice(0, 100);
  }, [trimmed, allSymbols, isExpression, exchangeFilter]);

  function selectExpression() {
    if (!isExpression) return;
    setSymbol(trimmed);
    setOpen(false);
    setQuery("");
  }

  /** Pick the most relevant match for the current query — used by Enter. */
  function bestMatch(): string | null {
    if (!trimmed) return null;
    if (isExpression && expressionValid) return trimmed;
    // 1) Exact ticker match wins
    const exact = filtered.find((s) => s.symbol.toUpperCase() === trimmed);
    if (exact) return exact.symbol;
    // 2) baseAsset exact match (e.g. "BTC" → "BTCUSDT" first hit)
    const baseExact = filtered.find((s) => s.baseAsset.toUpperCase() === trimmed);
    if (baseExact) return baseExact.symbol;
    // 3) First filtered result
    return filtered[0]?.symbol ?? null;
  }

  function submitBestMatch() {
    const m = bestMatch();
    if (!m) return;
    setSymbol(m);
    setOpen(false);
    setQuery("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Closing ends the insert-after-this-row session so the next open
        // (header "+", another right-click) starts clean and appends normally.
        if (!v) setSymbolDialogInsertAfterId(null);
      }}
    >
      {!noTrigger && (
        <DialogTrigger className="group flex items-center gap-2 rounded px-3 py-1.5 text-sm font-semibold hover:bg-tv-panel-hover">
          <Search className="h-3.5 w-3.5 text-tv-text-muted group-hover:text-tv-text" />
          <span className="tabular-nums">{symbol}</span>
          <ChevronDown className="h-3.5 w-3.5 text-tv-text-muted" />
        </DialogTrigger>
      )}
      {/* `overflow-hidden` keeps every row inside the rounded panel — the
          popup is a CSS grid, so nothing clips by default. */}
      <DialogContent className="gap-0 overflow-hidden bg-tv-panel p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-tv-border px-4 py-3">
          <DialogTitle className="text-sm font-medium">Search symbol</DialogTitle>
        </DialogHeader>
        <div className="border-b border-tv-border p-3">
          <Input
            autoFocus
            placeholder="BTC, ETH, or expression: BTCUSDT/ETHUSDT…"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (isExpression && expressionValid) selectExpression();
              else submitBestMatch();
            }}
            className="bg-tv-bg"
          />
          <p className="mt-1.5 text-[10px] text-tv-text-muted">
            Combine symbols with{" "}
            <code className="rounded bg-tv-bg px-1">+ - * /</code> and{" "}
            <code className="rounded bg-tv-bg px-1">( )</code>. Example:{" "}
            <code className="rounded bg-tv-bg px-1">BTCUSDT+ETHUSDT</code>.
          </p>
          {/* Exchange filter chips */}
          {exchanges.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <ExchangeChip
                label="All"
                active={exchangeFilter === null}
                onClick={() => setExchangeFilter(null)}
              />
              {exchanges.map((ex) => (
                <ExchangeChip
                  key={ex}
                  label={ex}
                  active={exchangeFilter === ex}
                  onClick={() => setExchangeFilter(exchangeFilter === ex ? null : ex)}
                />
              ))}
            </div>
          )}
        </div>
        {/* `min-w-0` is load-bearing: as a grid item this defaults to
            `min-width: auto`, i.e. its min-content width — and a row's
            `truncate`d description is `white-space: nowrap`, so that min-content
            is the full untruncated string. The column track then grows past the
            dialog and the exchange badge + star spill onto the chart behind it.
            With min-width 0 the track stays put and the text truncates. */}
        <ScrollArea className="h-[400px] min-w-0">
          <div className="flex flex-col">
            {isExpression && (
              <button
                onClick={selectExpression}
                disabled={!expressionValid}
                className={cn(
                  "flex items-center justify-between border-b border-tv-border px-4 py-3 text-left text-xs",
                  expressionValid
                    ? "hover:bg-tv-panel-hover"
                    : "cursor-not-allowed opacity-50",
                )}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-tv-blue" />
                  <span className="font-mono font-semibold text-tv-text">
                    {trimmed}
                  </span>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-tv-text-muted">
                  {expressionValid ? "Use expression" : "Unknown symbol"}
                </span>
              </button>
            )}
            {filtered.length === 0 && !isExpression && (
              <div className="p-4 text-center text-xs text-tv-text-muted">
                No results
              </div>
            )}
            {filtered.map((s) => {
              const inList = activeWatchlistSymbols.has(s.symbol);
              return (
                <div
                  key={s.symbol}
                  className={cn(
                    "group flex min-w-0 items-center justify-between gap-2 border-b border-tv-border px-4 py-2 text-xs hover:bg-tv-panel-hover",
                    s.symbol === symbol && "bg-tv-panel-hover",
                  )}
                >
                  <button
                    onClick={() => {
                      setSymbol(s.symbol);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <SymbolIcon
                        symbol={s.symbol}
                        source={s.source}
                        category={s.category}
                      />
                      <div className="flex min-w-0 flex-col">
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <span className="font-semibold text-tv-text">
                            {s.baseAsset}
                          </span>
                          <span className="truncate text-tv-text-muted">
                            / {s.quoteAsset}
                          </span>
                        </div>
                        <span className="truncate text-[10px] text-tv-text-muted">
                          {s.description}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-tv-panel-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-tv-text-muted">
                      {s.exchange}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!inList) {
                        addSymbolToWatchlist(activeWatchlistId, s.symbol);
                      }
                    }}
                    disabled={inList}
                    title={
                      inList ? "Already in active watchlist" : "Add to watchlist"
                    }
                    className={cn(
                      "rounded p-1 transition-colors",
                      inList
                        ? "text-tv-yellow"
                        : "text-tv-text-dim hover:bg-tv-bg hover:text-tv-yellow",
                    )}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      fill={inList ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** Pill toggle used by the exchange filter row. */
function ExchangeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-tv-text text-tv-bg"
          : "bg-tv-bg text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
      )}
    >
      {label}
    </button>
  );
}
