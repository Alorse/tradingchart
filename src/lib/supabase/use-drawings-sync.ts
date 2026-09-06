"use client";

import { useEffect, useRef } from "react";
import { clearPersistedDrawings, useDrawingsStore } from "@/lib/store/drawings-store";
import { useAuth } from "./auth-context";
import { loadDrawings } from "./drawings-data";

/**
 * Loads the user's drawings from Supabase once after sign-in.
 * Per-drawing mutations are persisted directly from the action wrapper hook
 * (use-drawings.ts) — no debounced full snapshot needed.
 *
 * The store itself persists to localStorage (see `drawings-store.ts`), which
 * is what lets a signed-out guest keep their drawings across a reload. Load
 * semantics are unchanged and still "cloud wins": a non-empty cloud result
 * replaces whatever rehydrated locally.
 */
export function useDrawingsSync() {
  const { user } = useAuth();
  const initializedRef = useRef(false);
  const prevUserIdRef = useRef<string | null>(null);
  const setDrawings = useDrawingsStore((s) => s.setDrawings);

  // ── Wipe local drawings on sign-out / user switch ──────────────────────
  // Now that drawings survive a reload in this browser's localStorage, signing
  // out would otherwise leave the last user's drawings sitting there for the
  // next person to open the app — and bleed them onto a *different* user's
  // chart on their own sign-in, since the cloud load only replaces the local
  // set when it comes back non-empty.
  //
  // Keyed on a *change* of signed-in id rather than merely "no user", so a
  // first sign-in (null -> id) leaves the guest's own drawings alone.
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentId) {
      useDrawingsStore.getState().clearDrawings();
      // Through the store's own persist path: a bare `removeItem` would leave
      // the storage handle's pending batched write queued to re-create the
      // blob (see `clearPersistedDrawings`).
      clearPersistedDrawings();
      // A direct A -> B switch never passes through `user == null`, so the
      // load effect below would otherwise still consider itself initialized
      // and leave B staring at the empty canvas this wipe just produced.
      initializedRef.current = false;
    }
    prevUserIdRef.current = currentId;
  }, [user]);

  useEffect(() => {
    if (!user) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;

    loadDrawings().then((drawings) => {
      if (drawings.length > 0) setDrawings(drawings);
    });
  }, [user, setDrawings]);
}
