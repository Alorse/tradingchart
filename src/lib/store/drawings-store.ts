"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import type { Drawing } from "@/lib/drawings/types";

export type PlacementPhase = "idle" | "placing";

export interface PlacementState {
  /** Drawing being built (null when idle) */
  draft: Drawing | null;
  /** Number of points already placed */
  step: number;
  /** Total points needed for current tool */
  pointsNeeded: number;
}

export const INITIAL_PLACEMENT: PlacementState = {
  draft: null,
  step: 0,
  pointsNeeded: 0,
};

interface DrawingsState {
  /** All drawings across all symbols */
  drawings: Drawing[];
  /** Currently selected drawing id (null = none) */
  selectedId: string | null;
  /** Drawing whose settings dialog is open (null = closed) */
  editingId: string | null;
  /** In-progress drawing placement */
  placement: PlacementState;

  // Actions
  setDrawings: (drawings: Drawing[]) => void;
  addDrawing: (d: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  clearDrawings: (symbol?: string) => void;
  /** Move a drawing within its same-symbol siblings' stacking order. */
  moveDrawing: (
    id: string,
    direction: "front" | "back" | "forward" | "backward",
  ) => void;
  /** Reorder a symbol's drawings to match `orderedIds` (used by undo/redo). */
  applyOrderForSymbol: (symbol: string, orderedIds: string[]) => void;
  setSelected: (id: string | null) => void;
  setEditing: (id: string | null) => void;

  setPlacement: (placement: PlacementState) => void;
  resetPlacement: () => void;
}

export const DRAWINGS_STORAGE_KEY = "tv-gratis-drawings";

type Persisted = { drawings: Drawing[] };

/**
 * A drawing must at least be a plain object carrying the three fields every
 * `switch (drawing.kind)` in the render / hit-test / serialize paths depends
 * on. A hand-edited or truncated blob otherwise reaches `DrawingsLayer` and
 * takes the whole chart down; dropping the bad item keeps the rest of a
 * mostly-intact blob, the same shape `paper-trading-store` uses for its
 * persisted positions.
 */
function isPersistableDrawing(d: unknown): d is Drawing {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const r = d as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.symbol === "string" &&
    typeof r.kind === "string"
  );
}

/**
 * Coalesced localStorage writes.
 *
 * `persist` re-serializes the persisted slice on *every* `set`, and
 * `updateLive` (see `use-drawings.ts`) calls `set` straight from a raw
 * `mousemove` handler — dragging one drawing would otherwise mean a
 * synchronous `JSON.stringify` + `setItem` of every drawing on every symbol,
 * dozens of times a second, on the frame path. Writes are therefore batched
 * onto a short trailing timer.
 *
 * The timer is why the flush is also wired to `pagehide`/`visibilitychange`:
 * a reload or tab close inside the window would otherwise drop the last move
 * of the drag, which is exactly the "drew something, reloaded, lost it" bug
 * this persistence exists to fix.
 */
const WRITE_THROTTLE_MS = 250;

/**
 * Force the pending batched write out now — assigned by
 * `createDrawingsStorage()` below. Exists so tests (and any caller that needs
 * the blob on disk immediately) don't have to wait out `WRITE_THROTTLE_MS`.
 */
export let flushDrawingsStorage: () => void = () => {};

function createDrawingsStorage(): PersistStorage<Persisted> {
  let pending: { name: string; value: StorageValue<Persisted> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    globalThis.localStorage?.setItem(name, JSON.stringify(value));
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    // `pagehide` doesn't fire when a backgrounded tab is discarded on mobile;
    // hiding is the last event guaranteed to arrive there.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  flushDrawingsStorage = flush;

  return {
    // Rehydration happens before any write, but a pending value still wins:
    // it is by definition newer than whatever is on disk.
    getItem: (name) => {
      if (pending && pending.name === name) return pending.value;
      const raw = globalThis.localStorage?.getItem(name);
      return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer === null) timer = setTimeout(flush, WRITE_THROTTLE_MS);
    },
    removeItem: (name) => {
      pending = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      globalThis.localStorage?.removeItem(name);
    },
  };
}

export const useDrawingsStore = create<DrawingsState>()(
  persist(
    (set, get) => ({
      drawings: [],
      selectedId: null,
      editingId: null,
      placement: INITIAL_PLACEMENT,

      setDrawings: (drawings) => set({ drawings }),
      addDrawing: (d) => set((s) => ({ drawings: [...s.drawings, d] })),
      updateDrawing: (id, patch) =>
        set((s) => ({
          drawings: s.drawings.map((d) =>
            d.id === id ? ({ ...d, ...patch } as Drawing) : d,
          ),
        })),
      removeDrawing: (id) =>
        set((s) => ({
          drawings: s.drawings.filter((d) => d.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      clearDrawings: (symbol) =>
        set((s) => ({
          drawings: symbol
            ? s.drawings.filter((d) => d.symbol !== symbol)
            : [],
          selectedId: null,
        })),
      applyOrderForSymbol: (symbol, orderedIds) =>
        set((s) => {
          // Slots (array indices) occupied by this symbol's drawings, in array order.
          const slots: number[] = [];
          s.drawings.forEach((d, i) => {
            if (d.symbol === symbol) slots.push(i);
          });
          const byId = new Map(s.drawings.map((d) => [d.id, d] as const));
          const next = [...s.drawings];
          orderedIds.forEach((id, k) => {
            const d = byId.get(id);
            if (d && slots[k] !== undefined) next[slots[k]] = d;
          });
          // z mirrors the final array index so the order survives a reload.
          return { drawings: next.map((d, i) => ({ ...d, z: i }) as Drawing) };
        }),
      moveDrawing: (id, direction) => {
        const s = get();
        const target = s.drawings.find((d) => d.id === id);
        if (!target) return;
        // Same-symbol siblings in array order (last = front-most / on top).
        const ids = s.drawings.filter((d) => d.symbol === target.symbol).map((d) => d.id);
        const from = ids.indexOf(id);
        let to = from;
        if (direction === "forward") to = Math.min(ids.length - 1, from + 1);
        else if (direction === "backward") to = Math.max(0, from - 1);
        else if (direction === "front") to = ids.length - 1;
        else if (direction === "back") to = 0;
        if (to === from) return;
        ids.splice(from, 1);
        ids.splice(to, 0, id);
        get().applyOrderForSymbol(target.symbol, ids);
      },
      setSelected: (selectedId) => set({ selectedId }),
      setEditing: (editingId) => set({ editingId }),

      setPlacement: (placement) => set({ placement }),
      resetPlacement: () => set({ placement: INITIAL_PLACEMENT }),
    }),
    {
      name: DRAWINGS_STORAGE_KEY,
      version: 1,
      // Going through `globalThis.localStorage` (rather than `window`) is
      // identical in the browser and is what lets the offline `node --test`
      // suite exercise this round trip for real.
      storage: createDrawingsStorage(),
      // Only the drawings themselves. Selection, the open settings dialog and
      // an in-flight placement are session state — persisting `placement`
      // would resurrect a half-placed draft on the next load, waiting for a
      // click the user never made.
      partialize: (s) => ({ drawings: s.drawings }),
      merge: (persisted, current) => {
        const raw = persisted as { drawings?: unknown } | undefined;
        const drawings = Array.isArray(raw?.drawings)
          ? raw.drawings.filter(isPersistableDrawing)
          : current.drawings;
        return { ...current, drawings };
      },
    },
  ),
);

/**
 * Drops the persisted drawings blob through `persist`'s own storage handle
 * (`createDrawingsStorage` above) rather than a bare
 * `localStorage.removeItem(DRAWINGS_STORAGE_KEY)`, which would leave the
 * pending batched write queued and let it re-create the blob milliseconds
 * later.
 *
 * Used by the sign-out / user-switch wipe in `use-drawings-sync.ts`.
 */
export function clearPersistedDrawings() {
  useDrawingsStore.persist.clearStorage();
}
