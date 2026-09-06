import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  DRAWINGS_STORAGE_KEY,
  clearPersistedDrawings,
  flushDrawingsStorage,
  useDrawingsStore,
} from "./drawings-store";
import type { Drawing } from "@/lib/drawings/types";

const st = () => useDrawingsStore.getState();

const hline = (id: string, symbol = "BTCUSDT", price = 100): Drawing =>
  ({ id, symbol, kind: "hline", price }) as Drawing;

/** What is actually on disk right now, flushing the batched write first. */
function persistedDrawings(): unknown[] | null {
  flushDrawingsStorage();
  const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
  if (!raw) return null;
  return (JSON.parse(raw) as { state: { drawings: unknown[] } }).state.drawings;
}

beforeEach(() => {
  useDrawingsStore.setState({ drawings: [], selectedId: null, editingId: null });
  clearPersistedDrawings();
});

describe("drawings-store persistence", () => {
  it("writes added drawings to localStorage — a guest's work survives a reload", () => {
    st().addDrawing(hline("a"));
    st().addDrawing(hline("b", "ETHUSDT"));
    expect(persistedDrawings()).toHaveLength(2);
  });

  it("round-trips through the persisted blob", () => {
    st().addDrawing(hline("a", "BTCUSDT", 42));
    flushDrawingsStorage();
    // The blob the store itself wrote — this is what a reload would find.
    const blob = localStorage.getItem(DRAWINGS_STORAGE_KEY);
    expect(typeof blob).toBe("string");

    // Simulate the reload: wipe in-memory state, put the blob back (the wipe
    // queues a write of the now-empty state, so flush it out of the way
    // first), then rehydrate the way a fresh page load does.
    useDrawingsStore.setState({ drawings: [] });
    flushDrawingsStorage();
    localStorage.setItem(DRAWINGS_STORAGE_KEY, blob!);
    useDrawingsStore.persist.rehydrate();

    expect(st().drawings).toHaveLength(1);
    expect(st().drawings[0].id).toBe("a");
    expect((st().drawings[0] as { price: number }).price).toBe(42);
  });

  it("drops removed and cleared drawings from storage too", () => {
    st().addDrawing(hline("a"));
    st().addDrawing(hline("b"));
    st().removeDrawing("a");
    expect(persistedDrawings()).toHaveLength(1);
    st().clearDrawings();
    expect(persistedDrawings()).toHaveLength(0);
  });

  it("does not persist selection, the open editor or an in-flight placement", () => {
    st().addDrawing(hline("a"));
    st().setSelected("a");
    st().setEditing("a");
    st().setPlacement({ draft: hline("draft"), step: 1, pointsNeeded: 2 });
    flushDrawingsStorage();
    const state = JSON.parse(localStorage.getItem(DRAWINGS_STORAGE_KEY)!).state;
    expect(Object.keys(state)).toEqual(["drawings"]);
  });

  it("coalesces the writes a drag produces into one trailing write", () => {
    st().addDrawing(hline("a", "BTCUSDT", -1));
    flushDrawingsStorage();
    // 50 `updateLive`-style mutations, as one pointermove run would produce.
    for (let i = 0; i < 50; i++) st().updateDrawing("a", { price: i } as Partial<Drawing>);
    // Still the pre-drag value on disk: the run is batched, not written per
    // mousemove — that's the whole point of the throttled storage handle.
    const onDisk = JSON.parse(localStorage.getItem(DRAWINGS_STORAGE_KEY)!);
    expect(onDisk.state.drawings[0].price).toBe(-1);
    // …and the one trailing write carries the final position, not a stale one.
    expect((persistedDrawings()![0] as { price: number }).price).toBe(49);
  });

  it("keeps the good drawings out of a corrupted blob instead of dropping all of them", () => {
    // Flush first: a pending write always wins over disk, so the hand-written
    // blob below has to land after the queue is empty.
    flushDrawingsStorage();
    localStorage.setItem(
      DRAWINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          drawings: [
            hline("ok"),
            null,
            "nope",
            { id: "", symbol: "BTCUSDT", kind: "hline" },
            { id: "no-kind", symbol: "BTCUSDT" },
            { id: "no-symbol", kind: "hline" },
          ],
        },
      }),
    );
    useDrawingsStore.persist.rehydrate();
    expect(st().drawings).toHaveLength(1);
    expect(st().drawings[0].id).toBe("ok");
  });

  it("clearPersistedDrawings drops the blob and the pending write with it", () => {
    st().addDrawing(hline("a"));
    // No flush: the write is still queued, exactly as it is on a sign-out that
    // lands mid-drag. Clearing must cancel it, not let it re-create the blob.
    clearPersistedDrawings();
    flushDrawingsStorage();
    expect(localStorage.getItem(DRAWINGS_STORAGE_KEY)).toBe(null);
  });
});
