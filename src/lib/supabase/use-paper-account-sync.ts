"use client";

import { useEffect, useRef } from "react";
import { usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { useAuth } from "./auth-context";
import { loadPaperAccount, savePaperAccount } from "./paper-account-data";

const DEBOUNCE_MS = 500;

/**
 * Syncs the paper trading account to Supabase, mirroring `useCloudSync`'s
 * shape: load once on sign-in, debounce-save on subsequent mutations.
 *
 * Load semantics are "cloud wins": if a cloud row already exists it replaces
 * whatever is in localStorage (`setAccount`), on the assumption that the
 * cloud copy is the more recent device. If there is no cloud row yet (first
 * sign-in on this account), the current local account is pushed up once so a
 * logged-out session's paper trades aren't lost.
 *
 * Single-tab / last-write-wins, same trade-off `paper-trading-store.ts`
 * documents for its localStorage persistence: two tabs (or two devices)
 * trading the same account concurrently will have one overwrite the other on
 * the next debounced save, with no merge. Multi-tab conflict resolution is
 * out of scope (#9).
 *
 * Subscribing to `account` alone (not the whole store) is what makes a
 * mark-only tick a no-op here for free — `evaluateTick` keeps `account`
 * reference-stable when a tick doesn't trigger a fill/close, so this effect's
 * dependency array doesn't see it and no save is scheduled.
 */
export function usePaperAccountSync() {
  const { user } = useAuth();
  const initializedRef = useRef(false);
  const account = usePaperTradingStore((s) => s.account);

  // ── Initial load on sign-in ────────────────────────────────────────────
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    loadPaperAccount().then((cloud) => {
      if (cloud) {
        usePaperTradingStore.getState().setAccount(cloud);
      } else {
        savePaperAccount(usePaperTradingStore.getState().account);
      }
    });
  }, [user]);

  // ── Reset on sign-out ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) initializedRef.current = false;
  }, [user]);

  // ── Debounced save on subsequent mutations ─────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !initializedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savePaperAccount(account);
    }, DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [user, account]);
}
