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

export async function savePaperAccount(account: PaperAccount) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_paper_accounts").upsert(
    { user_id: user.id, state: account, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}
