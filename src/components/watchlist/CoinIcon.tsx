"use client";

import { useState } from "react";
import { stripExchangePrefix } from "@/lib/symbols/prefix";

const QUOTE_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USD", "BTC", "ETH", "BNB"];

export function getBaseAsset(symbol: string): string {
  // Drop the exchange prefix and the .P perpetual suffix before matching, so
  // e.g. "BYBIT:SOLUSDT.P" resolves to "SOL" rather than "BYBIT:SOL".
  const s = stripExchangePrefix(symbol).replace(/\.P$/, "");
  for (const q of QUOTE_ASSETS) {
    if (s.endsWith(q)) return s.slice(0, -q.length);
  }
  return s;
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 60%, 42%)`;
}

interface Props {
  symbol: string;
  size?: number;
  /**
   * Try the crypto icon CDN first. Pass false for anything that is not a coin
   * (stocks, indices, macro series): the lookup would 404 on every row and
   * land on the letter avatar anyway, so skipping it saves the request.
   */
  remote?: boolean;
}

export function CoinIcon({ symbol, size = 18, remote = true }: Props) {
  const base = getBaseAsset(symbol);
  const slug = base.toLowerCase();
  const [errored, setErrored] = useState(false);
  // unpkg resolves the bare package name to its latest published version
  // (302 redirect), so the icon set stays current without pinning a version.
  const iconUrl = `https://unpkg.com/@bitgo-forks/cryptocurrency-icons/svg/color/${slug}.svg`;

  if (remote && !errored) {
    return (
      <img
        src={iconUrl}
        alt={base}
        width={size}
        height={size}
        className="shrink-0 rounded-full"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        fontWeight: 700,
        backgroundColor: hashColor(base),
      }}
    >
      {base.slice(0, 1)}
    </div>
  );
}
