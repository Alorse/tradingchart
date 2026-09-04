"use client";

import { createClient } from "./client";
import { sanitizePaperAccount } from "@/lib/store/paper-trading-store";
import type { PaperAccount } from "@/lib/trading/paper-engine";

/** Loads the signed-in user's paper account. Returns `null` when there is no
 *  row yet, the request fails, or the stored blob doesn't validate as a
 *  `PaperAccount` — same rejection rules the localStorage `persist` merge
 *  uses, via the shared `sanitizePaperAccount`. */
export async function loadPaperAccount(): Promise<PaperAccount | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_paper_accounts")
    .select("state")
    .single();
  if (error || !data) return null;
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
