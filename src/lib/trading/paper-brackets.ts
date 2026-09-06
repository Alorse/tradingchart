import type { PaperDirection } from "./paper-engine";

/**
 * The single definition of which side of a reference price each bracket has
 * to sit on: an SL above entry on a LONG (or below it on a SHORT) doesn't
 * protect against a loss, it books a gain the moment price moves at all and
 * mislabels it as a stop-out; TP mirrors it the other way.
 *
 * Three call sites need this rule and used to spell it out separately —
 * `normalizeBrackets` in `paper-engine.ts` *enforces* it by dropping a bad
 * value, while the order ticket and the position editor each *explain* it
 * before submitting. Three copies meant a change to the enforcement could
 * silently desync both explanations, so the predicate lives here and the
 * other two are wrappers.
 *
 * Deliberately unguarded against a non-finite `price`: the engine calls it
 * with a real fill price, and the message wrappers below do their own guard.
 */
export function bracketSidesValid(
  dir: PaperDirection,
  price: number,
  tp: number | null,
  sl: number | null,
): { tp: boolean; sl: boolean } {
  const long = dir === "LONG";
  return {
    tp: tp === null || (long ? tp > price : tp < price),
    sl: sl === null || (long ? sl < price : sl > price),
  };
}

/**
 * `bracketSidesValid` as a user-facing message. `noun` names what `price` is
 * at the call site — the order ticket compares against the quoted *price*,
 * the position editor against the position's *mark*. `null` means both
 * values (if any) are fine to submit.
 */
export function bracketSideReason(
  dir: PaperDirection,
  price: number,
  tp: number | null,
  sl: number | null,
  noun: "price" | "mark",
): string | null {
  if (!isFinite(price) || price <= 0) return null;
  const valid = bracketSidesValid(dir, price, tp, sl);
  const long = dir === "LONG";
  if (!valid.tp) return `Take-profit must be ${long ? "above" : "below"} the current ${noun}`;
  if (!valid.sl) return `Stop-loss must be ${long ? "below" : "above"} the current ${noun}`;
  return null;
}

/**
 * The positions panel's TP/SL editor, so it can explain *why* a value would
 * be dropped instead of it just vanishing after `setBrackets` re-validates
 * against the live mark.
 */
export function bracketEditReason(
  side: PaperDirection,
  referencePrice: number,
  tp: number | null,
  sl: number | null,
): string | null {
  return bracketSideReason(side, referencePrice, tp, sl, "mark");
}
