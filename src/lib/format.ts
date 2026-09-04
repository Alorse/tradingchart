/**
 * Decimal places to show for a price, scaled to its magnitude so a
 * fractions-of-a-cent altcoin (e.g. 0.00012) gets enough digits to read
 * while a BTC-sized price stays at 2. Drives the chart's native price
 * scale (`priceFormat`), which lightweight-charts otherwise defaults to a
 * flat 2 decimals regardless of the instrument.
 *
 * Capped at 4 for anything down to $0.0001 — more digits than that just
 * makes the ruler noisy. Below $0.0001 a fixed 6 keeps the axis from
 * flattening to "0.0000" on every label; the ruler can't render the
 * exponential notation `formatPrice` falls back to there.
 */
export function pricePrecisionFor(price: number): number {
  const abs = Math.abs(price);
  if (!isFinite(abs) || abs === 0) return 2;
  if (abs >= 1) return 2;
  if (abs >= 0.0001) return 4;
  return 6;
}

/** `priceFormat` fields (precision + matching minMove) for a series. */
export function priceFormatFor(price: number): { precision: number; minMove: number } {
  const precision = pricePrecisionFor(price);
  return { precision, minMove: Math.pow(10, -precision) };
}

export function formatPrice(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.0001) return n.toFixed(4);
  // Below 4 decimals everything would round to "0.0000"; text panels can
  // show the exponent even though the chart's price scale can't.
  return n.toExponential(2);
}

export function formatPct(n: number): string {
  if (!isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatVolume(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}
