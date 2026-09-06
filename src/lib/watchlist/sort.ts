/**
 * Pure watchlist sorting. Kept UI-free so it's unit-testable and reused by the
 * Watchlist component. "manual" preserves the user's drag order + section labels;
 * "price"/"change" produce a flat, sorted list of symbol rows.
 */
export type WatchSortKey = "manual" | "price" | "change";

export interface WatchSort {
  key: WatchSortKey;
  dir: "asc" | "desc";
}

export interface WatchRow {
  price: number;
  /** Undefined while the change baseline is still loading — sorted as unknown. */
  pct?: number;
}

interface ItemLike {
  id: string;
  type: "symbol" | "label";
  value: string;
}

/** Ordered items to render. Symbols with no live row are pushed to the end. */
export function sortWatchlistItems<T extends ItemLike>(
  items: T[],
  rows: Record<string, WatchRow>,
  sort: WatchSort,
): T[] {
  if (sort.key === "manual") return items;

  const symbols = items.filter((i) => i.type === "symbol");
  const missing = sort.dir === "asc" ? Infinity : -Infinity; // unknowns last
  const valueOf = (i: T): number => {
    const r = rows[i.value];
    if (!r) return missing;
    const v = sort.key === "price" ? r.price : r.pct;
    return v ?? missing;
  };

  return [...symbols].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === bv) return 0;
    return sort.dir === "asc" ? av - bv : bv - av;
  });
}

/**
 * Header-click cycle: clicking a column goes desc → asc → manual; clicking a
 * different column starts at desc.
 */
export function cycleSort(current: WatchSort, key: "price" | "change"): WatchSort {
  if (current.key !== key) return { key, dir: "desc" };
  if (current.dir === "desc") return { key, dir: "asc" };
  return { key: "manual", dir: "desc" };
}
