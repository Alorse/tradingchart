/**
 * Short random id for store-owned entities — watchlists and their items, user
 * EMAs, drawing templates.
 *
 * Dependency-free leaf module: `chart-store` mints these ids, and
 * [supabase/watchlists-migrate.ts](./supabase/watchlists-migrate.ts) mints
 * replacements when a cloud row arrives carrying an entry without a usable
 * one. Those two had byte-identical private copies, which is exactly the pair
 * that has to agree — so the definition lives here rather than in the store,
 * which the pure cloud parser must not import at runtime.
 *
 * Note this is *not* the id format used by drawings (`drawings/types.ts`) or
 * alerts (`alerts-store.ts`); those prefix a timestamp so their ids sort by
 * creation, and are deliberately left alone.
 */
export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
