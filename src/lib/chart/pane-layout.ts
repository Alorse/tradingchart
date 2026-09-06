/**
 * Pane layout is persisted as *ratios* (each pane's share of the chart height,
 * summing to 1) rather than pixels, so a layout restores correctly on a
 * different viewport than the one it was captured on.
 */

/** A pane too short to be usable — a restored layout must never produce one. */
const MIN_RATIO = 0.03;

/** Scale a list of positive weights so it sums to 1. Returns null if unusable. */
export function normalizeRatios(weights: number[]): number[] | null {
  if (weights.length === 0) return null;
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) return null;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return weights.map((w) => w / total);
}

/**
 * Adapt a saved ratio list to the current pane count. Same count restores
 * exactly (the common case: same indicators, different symbol). Otherwise the
 * main pane keeps its saved share and the sub-panes split the remainder
 * equally, which beats a visual glitch when the mapping is ambiguous.
 */
export function adaptRatios(saved: number[] | null, paneCount: number): number[] | null {
  if (!saved || paneCount <= 0) return null;
  const normalized = normalizeRatios(saved);
  if (!normalized) return null;
  if (normalized.length === paneCount) return normalized;
  if (paneCount === 1) return [1];

  const main = Math.min(Math.max(normalized[0], MIN_RATIO), 1 - MIN_RATIO * (paneCount - 1));
  const rest = (1 - main) / (paneCount - 1);
  return [main, ...Array<number>(paneCount - 1).fill(rest)];
}
