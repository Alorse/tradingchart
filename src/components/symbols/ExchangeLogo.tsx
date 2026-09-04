"use client";

import type { SourceKind } from "@/lib/symbols/catalog";
import { VENUE_LABEL } from "@/lib/symbols/source";

/**
 * Small round venue mark, corner-pinned on a symbol's asset icon the way
 * TradingView tags a search result with the exchange it comes from.
 *
 * Brand-coloured monograms drawn inline rather than the venues' own artwork:
 * a remote logo is one more image request per row (the search list renders up
 * to 100 at a time) and one more thing that can fail to load, and the colour
 * is what actually reads at 11px. Binance and Bybit share an initial, so they
 * are told apart by inverted palettes rather than by the letter.
 *
 * The venue's *name* is not here — it comes from the shared `VENUE_LABEL`, so
 * this badge and any text naming the same venue stay in step.
 */
const MARKS: Record<SourceKind | "synthetic", { bg: string; fg: string; text: string }> = {
  binance: { bg: "#f0b90b", fg: "#181a20", text: "B" },
  bybit: { bg: "#17181e", fg: "#f7a600", text: "B" },
  yahoo: { bg: "#5f01d1", fg: "#ffffff", text: "Y" },
  fred: { bg: "#134a8e", fg: "#ffffff", text: "F" },
  coingecko: { bg: "#8dc63f", fg: "#1a1a1a", text: "G" },
  synthetic: { bg: "#2962ff", fg: "#ffffff", text: "∑" },
};

interface Props {
  source: SourceKind | "synthetic";
  size?: number;
}

export function ExchangeLogo({ source, size = 11 }: Props) {
  const mark = MARKS[source] ?? MARKS.binance;
  const label = VENUE_LABEL[source] ?? VENUE_LABEL.binance;
  return (
    <span
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center justify-center rounded-full ring-1 ring-tv-panel"
      style={{
        width: size,
        height: size,
        backgroundColor: mark.bg,
        color: mark.fg,
        fontSize: size * 0.62,
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {mark.text}
    </span>
  );
}
