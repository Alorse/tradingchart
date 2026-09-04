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

/**
 * Reconcile the exchange's own tick-size precision with our readability cap.
 *
 * An exchange quotes a cheap altcoin to 6-8 decimals, which is the truth for
 * *order placement* but far more digits than the price ruler should carry —
 * applying it verbatim is what made the axis noisy again after
 * `pricePrecisionFor` had already capped the magnitude-based guess at 4.
 * Below $1 we therefore clamp to that same cap; at $1 and above the exchange
 * value is kept as-is, since that's what gives BTC 1 decimal, ETH 2 and NEAR 3
 * instead of flattening every symbol to the library's default 2.
 */
export function cappedPricePrecision(price: number, exchangePrecision: number): number {
  if (!isFinite(exchangePrecision) || exchangePrecision < 0) return pricePrecisionFor(price);
  const abs = Math.abs(price);
  if (!isFinite(abs) || abs >= 1) return exchangePrecision;
  return Math.min(exchangePrecision, 4);
}

/**
 * `priceFormat` fields from an exchange precision, capped for readability.
 * `minMove` is derived from the *capped* precision rather than reusing the raw
 * tick size — pairing a 4-decimal precision with an 0.00000001 tick makes
 * lightweight-charts round labels to a step the axis can no longer show.
 */
export function exchangePriceFormatFor(
  price: number,
  exchangePrecision: number,
): { precision: number; minMove: number } {
  const precision = cappedPricePrecision(price, exchangePrecision);
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
