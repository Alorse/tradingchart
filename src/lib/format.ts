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

/**
 * Signed change amount (e.g. "+46.26" / "-0.0012"), with the decimal count
 * taken from the instrument's price magnitude via `pricePrecisionFor` so a
 * sub-$1 symbol keeps the digits it needs to show any move at all.
 */
export function formatChangeAmount(amount: number, price: number): string {
  if (!isFinite(amount)) return "—";
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${amount.toFixed(pricePrecisionFor(price))}`;
}

export function formatVolume(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

/** Hard ceiling for `priceInputDecimals`: past 12 decimals there is nothing
 *  left but float noise, even for the cheapest meme coins. */
const MAX_INPUT_DECIMALS = 12;

/**
 * Decimal places an editable price field rounds to. At $1 and above a flat 3
 * is plenty; below $1 it's 5 *significant* digits counted from the first
 * non-zero one, because a flat decimal cap is exactly what fails cheap coins —
 * 0.0000000512 at 5 decimals becomes 0, and since the field is editable,
 * pressing Ok would then write that 0 back into the drawing.
 *
 * `minDecimals` lets a caller that steps the value by a known tick keep that
 * tick's digits: a 0.0001 tick on a $2 symbol would otherwise be swallowed by
 * the 3-decimal cap and the stepper would stop moving the price.
 */
function priceInputDecimals(abs: number, minDecimals: number): number {
  const byMagnitude = abs >= 1 || abs === 0 ? 3 : 4 - Math.floor(Math.log10(abs));
  return Math.min(MAX_INPUT_DECIMALS, Math.max(byMagnitude, minDecimals));
}

/** `toFixed` without its padding: "86234.100" → "86234.1", "2.000" → "2".
 *  Also folds "-0" (a tiny negative rounded away) into "0". */
function stripTrailingZeros(fixed: string): string {
  const s = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return s === "-0" ? "0" : s;
}

/**
 * Display string for an editable price input: at most 3 decimals at/above $1,
 * 5 significant digits below it (never more than 12 decimals), trailing zeros
 * stripped. Unlike `formatPrice` it never falls back to exponential notation
 * or thousands separators — the string has to round-trip through
 * `parseFloat` and read naturally inside an `<input type="number">`.
 * Non-finite input renders as an empty field rather than "NaN"/"Infinity".
 */
export function formatPriceInput(price: number, minDecimals = 0): string {
  if (!isFinite(price)) return "";
  return stripTrailingZeros(price.toFixed(priceInputDecimals(Math.abs(price), minDecimals)));
}

/**
 * The same rounding as `formatPriceInput`, applied to the value that gets
 * stored — prettifying only the text would leave `2.6759999999999997` in the
 * drawing, and the noise would resurface on the chart and in Supabase.
 * Non-finite input is returned unchanged.
 */
export function roundPriceForInput(price: number, minDecimals = 0): number {
  if (!isFinite(price)) return price;
  const n = Number(price.toFixed(priceInputDecimals(Math.abs(price), minDecimals)));
  return n === 0 ? 0 : n;
}

/**
 * Display string for an editable non-price number (leverage, account size,
 * lot size…): rounded to `maxDecimals` and trailing zeros stripped, so float
 * noise like `0.30000000000000004` never reaches the field. Non-finite input
 * renders as an empty field.
 */
export function formatDecimalInput(n: number, maxDecimals: number): string {
  if (!isFinite(n)) return "";
  return stripTrailingZeros(n.toFixed(maxDecimals));
}

/** The stored-value counterpart of `formatDecimalInput`. */
export function roundDecimalForInput(n: number, maxDecimals: number): number {
  if (!isFinite(n)) return n;
  const r = Number(n.toFixed(maxDecimals));
  return r === 0 ? 0 : r;
}

/**
 * Decimal places a step size carries (0.01 → 2, 0.00005 → 5, 1e-8 → 8), for
 * `formatPriceInput`'s `minDecimals`. Counted numerically rather than off the
 * string, since `String(1e-8)` is already exponential.
 */
export function stepDecimals(step: number): number {
  if (!isFinite(step) || step <= 0) return 0;
  for (let d = 0; d < MAX_INPUT_DECIMALS; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return MAX_INPUT_DECIMALS;
}
