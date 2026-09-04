import type { PaperDirection } from "./paper-engine";

/**
 * Mirrors the engine's own `normalizeBrackets` rule in `paper-engine.ts`
 * (long: TP above price, SL below; short: the reverse) so the positions
 * panel's TP/SL editor can explain *why* a value would be dropped instead of
 * it just vanishing after `setBrackets` re-validates against the live mark —
 * same reasoning as `invalidBracketReason` in `paper-order-form.ts`, but
 * against a position's current side/mark rather than an order-ticket form.
 * `null` means both values (if any) are fine to submit.
 */
export function bracketEditReason(
  side: PaperDirection,
  referencePrice: number,
  tp: number | null,
  sl: number | null,
): string | null {
  if (!isFinite(referencePrice) || referencePrice <= 0) return null;
  const long = side === "LONG";
  if (tp !== null && (long ? tp <= referencePrice : tp >= referencePrice)) {
    return `Take-profit must be ${long ? "above" : "below"} the current mark`;
  }
  if (sl !== null && (long ? sl >= referencePrice : sl <= referencePrice)) {
    return `Stop-loss must be ${long ? "below" : "above"} the current mark`;
  }
  return null;
}
