import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { watchlistSortFingerprint } from "./useWatchlistSort";

type Item = { id: string; type: "symbol" | "label"; value: string };
const sym = (v: string): Item => ({ id: v, type: "symbol", value: v });

const items = [sym("BTCUSDT"), sym("ETHUSDT")];
const opens = { BTCUSDT: 60000, ETHUSDT: 3000 };

describe("watchlistSortFingerprint", () => {
  it("is stable across price ticks (prices are not an input)", () => {
    const a = watchlistSortFingerprint(items, opens, { key: "price", dir: "desc" });
    const b = watchlistSortFingerprint([...items], { ...opens }, { key: "price", dir: "desc" });
    expect(a).toBe(b);
  });

  it("changes when the sort key or direction changes", () => {
    const base = watchlistSortFingerprint(items, opens, { key: "price", dir: "desc" });
    expect(watchlistSortFingerprint(items, opens, { key: "price", dir: "asc" })).not.toBe(base);
    expect(watchlistSortFingerprint(items, opens, { key: "change", dir: "desc" })).not.toBe(base);
    expect(watchlistSortFingerprint(items, opens, { key: "manual", dir: "desc" })).not.toBe(base);
  });

  it("changes when a symbol is added, removed or reordered", () => {
    const base = watchlistSortFingerprint(items, opens, { key: "price", dir: "desc" });
    expect(watchlistSortFingerprint([...items, sym("SOLUSDT")], opens, { key: "price", dir: "desc" }))
      .not.toBe(base);
    expect(watchlistSortFingerprint([items[0]], opens, { key: "price", dir: "desc" })).not.toBe(base);
    expect(watchlistSortFingerprint([items[1], items[0]], opens, { key: "price", dir: "desc" }))
      .not.toBe(base);
  });

  it("tracks dailyOpens for the change sort, so a late-loading open re-sorts", () => {
    const partial = watchlistSortFingerprint(items, { BTCUSDT: 60000 }, { key: "change", dir: "desc" });
    const full = watchlistSortFingerprint(items, opens, { key: "change", dir: "desc" });
    expect(partial).not.toBe(full);
    // A changed baseline (UTC midnight rollover) counts too.
    expect(watchlistSortFingerprint(items, { ...opens, BTCUSDT: 61000 }, { key: "change", dir: "desc" }))
      .not.toBe(full);
  });

  it("ignores dailyOpens for the price sort", () => {
    const a = watchlistSortFingerprint(items, opens, { key: "price", dir: "desc" });
    const b = watchlistSortFingerprint(items, { BTCUSDT: 1 }, { key: "price", dir: "desc" });
    expect(a).toBe(b);
  });

  it("is insensitive to dailyOpens key order", () => {
    const a = watchlistSortFingerprint(items, { BTCUSDT: 60000, ETHUSDT: 3000 }, { key: "change", dir: "asc" });
    const b = watchlistSortFingerprint(items, { ETHUSDT: 3000, BTCUSDT: 60000 }, { key: "change", dir: "asc" });
    expect(a).toBe(b);
  });
});
