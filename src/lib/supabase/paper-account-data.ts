"use client";

import { createClient } from "./client";
import { sanitizePaperAccount } from "@/lib/store/paper-trading-store";
import type { PaperAccount } from "@/lib/trading/paper-engine";

/**
 * Loads the signed-in user's paper account. Returns `null` when there is
 * genuinely no row yet (a fresh account, or one that doesn't validate as a
 * `PaperAccount` — same rejection rules the localStorage `persist` merge
 * uses, via the shared `sanitizePaperAccount`), and *throws* on any other
 * failure (network error, RLS rejection, etc).
 *
 * `.maybeSingle()` rather than `.single()`: the latter treats "no row" as an
 * error indistinguishable from a real failure, so the caller (the sync hook)
 * used to skip the cloud entirely on things like a dropped connection and
 * proceed to push whatever is in localStorage up — silently overwriting a
 * real cloud row with a stale or default local one. Letting a genuine error
 * propagate lets the caller skip syncing for the session instead.
 */
export async function loadPaperAccount(): Promise<PaperAccount | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_paper_accounts")
    .select("state")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return sanitizePaperAccount(data.state);
}

/**
 * Upserts the account for `userId`. The id is a *parameter* rather than
 * something re-derived from `supabase.auth.getUser()` here: that is not a
 * local read — it round-trips to the auth server on every call — so each
 * debounced save was two sequential requests instead of one, for an id
 * `usePaperAccountSync` already holds via `useAuth()`. RLS
 * (`auth.uid() = user_id`) is what authorizes the row. Same reasoning, and
 * same argument order, as the save functions in `user-data.ts`.
 *
 * Rejects on a failed upsert instead of swallowing the error, so a cloud save
 * that never landed is distinguishable from one that did — callers that
 * fire-and-forget must attach a `.catch`.
 */
export async function savePaperAccount(userId: string, account: PaperAccount): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("user_paper_accounts").upsert(
    { user_id: userId, state: account, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}
