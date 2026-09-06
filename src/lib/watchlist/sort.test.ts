import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { sortWatchlistItems, cycleSort, type WatchRow } from "./sort";

type Item = { id: string; type: "symbol" | "label"; value: string };
const sym = (v: string): Item => ({ id: v, type: "symbol", value: v });
const label = (v: string): Item => ({ id: `L:${v}`, type: "label", value: v });

const rows: Record<string, WatchRow> = {
  BTCUSDT: { price: 60000, pct: 2.5 },
  ETHUSDT: { price: 3000, pct: -1.2 },
  SOLUSDT: { price: 150, pct: 8.0 },
};

describe("sortWatchlistItems", () => {
  it("manual returns items unchanged (labels kept)", () => {
    const items = [label("majors"), sym("BTCUSDT"), sym("ETHUSDT")];
    const out = sortWatchlistItems(items, rows, { key: "manual", dir: "desc" });
    expect(out.map((i) => i.value)).toEqual(["majors", "BTCUSDT", "ETHUSDT"]);
  });

  it("sorts by change desc, dropping labels", () => {
    const items = [label("majors"), sym("BTCUSDT"), sym("ETHUSDT"), sym("SOLUSDT")];
    const out = sortWatchlistItems(items, rows, { key: "change", dir: "desc" });
    expect(out.map((i) => i.value)).toEqual(["SOLUSDT", "BTCUSDT", "ETHUSDT"]);
  });

  it("sorts by change asc", () => {
    const items = [sym("BTCUSDT"), sym("ETHUSDT"), sym("SOLUSDT")];
    const out = sortWatchlistItems(items, rows, { key: "change", dir: "asc" });
    expect(out.map((i) => i.value)).toEqual(["ETHUSDT", "BTCUSDT", "SOLUSDT"]);
  });

  it("sorts by price desc", () => {
    const items = [sym("SOLUSDT"), sym("ETHUSDT"), sym("BTCUSDT")];
    const out = sortWatchlistItems(items, rows, { key: "price", dir: "desc" });
    expect(out.map((i) => i.value)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });

  it("treats an unloaded change baseline as unknown, without affecting price sort", () => {
    // NEWUSDT has a price but no daily-change baseline yet (pct undefined).
    const partial: Record<string, WatchRow> = { ...rows, NEWUSDT: { price: 500 } };
    const items = [sym("BTCUSDT"), sym("NEWUSDT"), sym("SOLUSDT")];

    const desc = sortWatchlistItems(items, partial, { key: "change", dir: "desc" });
    expect(desc.map((i) => i.value)).toEqual(["SOLUSDT", "BTCUSDT", "NEWUSDT"]);
    const asc = sortWatchlistItems(items, partial, { key: "change", dir: "asc" });
    expect(asc.map((i) => i.value)).toEqual(["BTCUSDT", "SOLUSDT", "NEWUSDT"]);

    // Its price is known, so the price column still ranks it normally.
    const byPrice = sortWatchlistItems(items, partial, { key: "price", dir: "desc" });
    expect(byPrice.map((i) => i.value)).toEqual(["BTCUSDT", "NEWUSDT", "SOLUSDT"]);
  });

  it("pushes symbols without a live row to the end (both directions)", () => {
    const items = [sym("BTCUSDT"), sym("NEWUSDT"), sym("SOLUSDT")];
    const desc = sortWatchlistItems(items, rows, { key: "price", dir: "desc" });
    expect(desc.map((i) => i.value)).toEqual(["BTCUSDT", "SOLUSDT", "NEWUSDT"]);
    const asc = sortWatchlistItems(items, rows, { key: "price", dir: "asc" });
    expect(asc.map((i) => i.value)).toEqual(["SOLUSDT", "BTCUSDT", "NEWUSDT"]);
  });
});

describe("cycleSort", () => {
  it("cycles a column desc → asc → manual", () => {
    let s = cycleSort({ key: "manual", dir: "desc" }, "change");
    expect(s).toEqual({ key: "change", dir: "desc" });
    s = cycleSort(s, "change");
    expect(s).toEqual({ key: "change", dir: "asc" });
    s = cycleSort(s, "change");
    expect(s).toEqual({ key: "manual", dir: "desc" });
  });

  it("switching column starts at desc", () => {
    const s = cycleSort({ key: "change", dir: "asc" }, "price");
    expect(s).toEqual({ key: "price", dir: "desc" });
  });
});
