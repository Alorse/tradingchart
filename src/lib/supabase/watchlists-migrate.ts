import type { Watchlist, WatchlistItem } from "@/lib/store/chart-store";
import { randomId } from "@/lib/id";

/**
 * Pure parsing of a `user_watchlists` row into the store's `Watchlist[]`.
 *
 * Kept free of any Supabase import so it can be unit-tested directly: the
 * data layer ([user-data.ts](./user-data.ts)) does nothing but fetch the row
 * and hand it to `rowToWatchlists`.
 *
 * Three generations of that row exist in the wild and all three land here:
 * `symbols text[]` (oldest), `items jsonb` (migration 03, one list), and
 * `lists`/`active_id` (migration 06, every list). The DB backfill in
 * migration 06 folds the first two into `lists`, so the legacy branches below
 * only fire for a row that migration hasn't reached — belt and suspenders,
 * not the main path.
 */

/** Injected so tests get deterministic ids; production uses `randomId`. */
export type IdFactory = () => string;

/** A raw `user_watchlists` row, straight off the wire and wholly untrusted. */
export interface RawWatchlistRow {
  lists?: unknown;
  active_id?: unknown;
  items?: unknown;
  symbols?: unknown;
}

export interface CloudWatchlists {
  lists: Watchlist[];
  /** Always names a list in `lists`, which `rowToWatchlists` never leaves empty. */
  activeId: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Coerces a raw `items` array into `WatchlistItem[]`, dropping anything that
 * isn't a recognizable symbol/label entry and minting an id for one that
 * arrived without a usable one.
 */
export function sanitizeItems(raw: unknown, makeId: IdFactory = randomId): WatchlistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchlistItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { value } = entry;
    if (typeof value !== "string") continue;
    const id = typeof entry.id === "string" && entry.id ? entry.id : makeId();
    if (entry.type === "label") {
      out.push({ id, type: "label", value });
    } else if (entry.type === "symbol") {
      const item: WatchlistItem = { id, type: "symbol", value };
      if (typeof entry.flagColor === "string") item.flagColor = entry.flagColor;
      out.push(item);
    }
  }
  return out;
}

/**
 * Coerces a raw `lists` array into `Watchlist[]`. An *empty* list survives —
 * a named list the user deliberately emptied has to round-trip — but a
 * duplicate id doesn't: `activeWatchlistId` and every `watchlists.map()` in
 * `chart-store` key off that id, so two lists sharing one would both respond
 * to the same edit.
 */
export function sanitizeLists(raw: unknown, makeId: IdFactory = randomId): Watchlist[] {
  if (!Array.isArray(raw)) return [];
  const out: Watchlist[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    let id = typeof entry.id === "string" && entry.id ? entry.id : makeId();
    if (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    const name = typeof entry.name === "string" && entry.name ? entry.name : "Watchlist";
    out.push({ id, name, items: sanitizeItems(entry.items, makeId) });
  }
  return out;
}

/**
 * Folds a pre-migration-06 row's single list into the new array shape, under
 * the name "Default". `items` wins over `symbols` when both are present, the
 * same precedence the old `loadWatchlistItems` used. Returns `[]` when the
 * row carries no watchlist data at all, which the caller reads as "nothing in
 * the cloud, keep what's local".
 */
export function legacyToWatchlists(
  items: unknown,
  symbols: unknown,
  makeId: IdFactory = randomId,
): Watchlist[] {
  let legacyItems = sanitizeItems(items, makeId);
  if (legacyItems.length === 0) {
    legacyItems = (Array.isArray(symbols) ? symbols : [])
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((value) => ({ id: makeId(), type: "symbol" as const, value }));
  }
  if (legacyItems.length === 0) return [];
  return [{ id: makeId(), name: "Default", items: legacyItems }];
}

/**
 * Resolves which list is active, given a non-empty `lists` (the only caller
 * has already returned for the empty case). A stored `active_id` naming a list
 * that no longer exists (deleted on another device between that device's write
 * and this one's read) falls back to the first list rather than leaving the
 * store pointing at nothing — with no match, every watchlist action becomes a
 * silent no-op and the panel renders empty.
 */
function resolveActiveId(lists: Watchlist[], activeId: unknown): string {
  if (typeof activeId === "string" && lists.some((l) => l.id === activeId)) return activeId;
  return lists[0].id;
}

/**
 * The whole load path as one pure function: raw row in, adoptable state out.
 * `null` means the row holds no watchlist data in any generation of the
 * schema, so the caller should keep local state and seed the cloud from it.
 */
export function rowToWatchlists(
  row: RawWatchlistRow | null | undefined,
  makeId: IdFactory = randomId,
): CloudWatchlists | null {
  if (!row) return null;
  let lists = sanitizeLists(row.lists, makeId);
  // Only consult the legacy columns when `lists` is genuinely empty — once
  // the app has written `lists`, it is the sole source of truth and the frozen
  // `items`/`symbols` copy of one old list must not resurface.
  if (lists.length === 0) lists = legacyToWatchlists(row.items, row.symbols, makeId);
  if (lists.length === 0) return null;
  return { lists, activeId: resolveActiveId(lists, row.active_id) };
}
