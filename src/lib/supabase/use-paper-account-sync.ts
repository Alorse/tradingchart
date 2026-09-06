"use client";

import { useEffect, useRef } from "react";
import { clearPersistedPaperAccount, usePaperTradingStore } from "@/lib/store/paper-trading-store";
import { useAuth } from "./auth-context";
import { loadPaperAccount, savePaperAccount } from "./paper-account-data";

const DEBOUNCE_MS = 500;

/** Saves are fire-and-forget, but a rejected one still has to say so — without
 *  this the upsert's error was invisible and a failed cloud save looked
 *  exactly like a successful one. */
function logSaveFailure(err: unknown) {
  console.error("Failed to save paper account to Supabase", err);
}

/**
 * Syncs the paper trading account to Supabase, mirroring `useCloudSync`'s
 * shape: load once on sign-in, debounce-save on subsequent mutations.
 *
 * Load semantics are "cloud wins": if a cloud row already exists it replaces
 * whatever is in localStorage (`setAccount`), on the assumption that the
 * cloud copy is the more recent device. If there genuinely is no cloud row
 * yet (first sign-in ever on this account), the current local account is
 * pushed up once to seed it — the whole app is auth-gated (see
 * `src/middleware.ts`), so there is no "logged-out session's paper trades"
 * to preserve here, just whatever local seed/default this device happens to
 * have.
 *
 * The load is allowed to *fail* (network error, RLS rejection, anything
 * `loadPaperAccount` doesn't treat as "no row") without ever reaching either
 * branch above — `loadedRef` only flips to `true` on a successful load, and
 * the debounced-save effect below is gated on it. Without that gate, a
 * failed load used to leave `initializedRef` (now just "load attempted") set
 * and let the very next mutation's debounced save upsert the local
 * seed/default blob straight over a real cloud row it never actually saw.
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
  const loadedRef = useRef(false);
  const prevUserIdRef = useRef<string | null>(null);
  const account = usePaperTradingStore((s) => s.account);

  // ── Wipe local paper state on sign-out / user switch ───────────────────
  // The account persists to localStorage under one un-namespaced key
  // (`PAPER_STORAGE_KEY`), so signing out used to leave whatever the last
  // signed-in user was trading sitting in this browser's storage — visible
  // to the next person who opens the app on this device before signing in,
  // and liable to bleed into a *different* user's account on their own
  // sign-in via the "no cloud row yet, push local up" branch below, if that
  // runs before their own load lands. Runs before the load-on-sign-in effect
  // clears `initializedRef` (both fire off the same `user` change), so a
  // fresh sign-in always starts from a clean local slate.
  useEffect(() => {
    const currentId = user?.id ?? null;
    // A *change* of signed-in id, not merely "signed out": covers a sign-out
    // (id -> null) and a direct switch between two accounts alike, while
    // leaving a first sign-in (null -> id) alone so its local seed can still
    // be pushed up to a cloud row that doesn't exist yet.
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentId) {
      usePaperTradingStore.getState().resetAccount();
      // Through the store's own persist path, not a bare
      // `localStorage.removeItem`: the storage handle keeps a write-skip cache
      // that a hand-rolled removal would leave stale (see
      // `clearPersistedPaperAccount`), which makes the wipe depend on the
      // `resetAccount()` above happening first.
      clearPersistedPaperAccount();
    }
    prevUserIdRef.current = currentId;
  }, [user]);

  // ── Initial load on sign-in ────────────────────────────────────────────
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    loadPaperAccount()
      .then((cloud) => {
        if (cloud) {
          usePaperTradingStore.getState().setAccount(cloud);
        } else {
          savePaperAccount(usePaperTradingStore.getState().account, user.id).catch(logSaveFailure);
        }
        loadedRef.current = true;
      })
      .catch((err) => {
        // Leave `loadedRef` false: the debounced-save effect below stays
        // gated off for the rest of this session rather than risk upserting
        // an account the cloud load never actually confirmed.
        console.error("Failed to load paper account from Supabase; skipping paper sync this session", err);
      });
  }, [user]);

  // ── Reset on sign-out ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      initializedRef.current = false;
      loadedRef.current = false;
    }
  }, [user]);

  // ── Debounced save on subsequent mutations ─────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savePaperAccount(account, user.id).catch(logSaveFailure);
    }, DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [user, account]);
}
