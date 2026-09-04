import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  sanitizeItems,
  sanitizeLists,
  legacyToWatchlists,
  resolveActiveId,
  rowToWatchlists,
  type IdFactory,
} from "./watchlists-migrate";

/** Deterministic ids so the expectations can be written out in full. */
function counterId(prefix = "id"): IdFactory {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe("sanitizeItems", () => {
  it("keeps symbol and label entries, preserving ids and flags", () => {
    expect(
      sanitizeItems(
        [
          { id: "a", type: "symbol", value: "BTCUSDT" },
          { id: "b", type: "label", value: "Majors" },
          { id: "c", type: "symbol", value: "ETHUSDT", flagColor: "#ff0000" },
        ],
        counterId(),
      ),
    ).toEqual([
      { id: "a", type: "symbol", value: "BTCUSDT" },
      { id: "b", type: "label", value: "Majors" },
      { id: "c", type: "symbol", value: "ETHUSDT", flagColor: "#ff0000" },
    ]);
  });

  it("mints an id for an entry that arrived without one", () => {
    expect(sanitizeItems([{ type: "symbol", value: "SOLUSDT" }], counterId())).toEqual([
      { id: "id1", type: "symbol", value: "SOLUSDT" },
    ]);
  });

  it("drops entries that aren't a recognizable symbol or label", () => {
    const out = sanitizeItems(
      [
        { id: "a", type: "symbol", value: "BTCUSDT" },
        { id: "b", type: "wat", value: "nope" },
        { id: "c", type: "symbol" },
        { id: "d", type: "symbol", value: 42 },
        "BTCUSDT",
        null,
      ],
      counterId(),
    );
    expect(out).toEqual([{ id: "a", type: "symbol", value: "BTCUSDT" }]);
  });

  it("returns an empty array for a non-array payload", () => {
    expect(sanitizeItems(null)).toEqual([]);
    expect(sanitizeItems({ items: [] })).toEqual([]);
  });
});

describe("sanitizeLists", () => {
  it("parses the multi-list shape the store writes", () => {
    expect(
      sanitizeLists(
        [
          { id: "w1", name: "Crypto", items: [{ id: "a", type: "symbol", value: "BTCUSDT" }] },
          { id: "w2", name: "Stocks", items: [{ id: "b", type: "symbol", value: "AAPL" }] },
        ],
        counterId(),
      ),
    ).toEqual([
      { id: "w1", name: "Crypto", items: [{ id: "a", type: "symbol", value: "BTCUSDT" }] },
      { id: "w2", name: "Stocks", items: [{ id: "b", type: "symbol", value: "AAPL" }] },
    ]);
  });

  it("keeps a deliberately empty named list", () => {
    expect(sanitizeLists([{ id: "w1", name: "Later", items: [] }], counterId())).toEqual([
      { id: "w1", name: "Later", items: [] },
    ]);
  });

  it("fills in a missing id and name", () => {
    expect(sanitizeLists([{ items: [] }], counterId())).toEqual([
      { id: "id1", name: "Watchlist", items: [] },
    ]);
  });

  it("de-duplicates ids so two lists can't answer to the same edit", () => {
    const out = sanitizeLists(
      [
        { id: "dup", name: "One", items: [] },
        { id: "dup", name: "Two", items: [] },
      ],
      counterId(),
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("dup");
    expect(out[1].id).toBe("dup-1");
  });

  it("returns an empty array for a non-array payload", () => {
    expect(sanitizeLists(undefined)).toEqual([]);
  });
});

describe("legacyToWatchlists", () => {
  it("folds a legacy `items` list into a single Default list", () => {
    expect(
      legacyToWatchlists(
        [
          { id: "a", type: "symbol", value: "BTCUSDT" },
          { id: "b", type: "label", value: "Alts" },
        ],
        [],
        counterId("new"),
      ),
    ).toEqual([
      {
        id: "new1",
        name: "Default",
        items: [
          { id: "a", type: "symbol", value: "BTCUSDT" },
          { id: "b", type: "label", value: "Alts" },
        ],
      },
    ]);
  });

  it("falls back to the oldest `symbols text[]` column", () => {
    expect(legacyToWatchlists([], ["BTCUSDT", "ETHUSDT"], counterId())).toEqual([
      {
        id: "id3",
        name: "Default",
        items: [
          { id: "id1", type: "symbol", value: "BTCUSDT" },
          { id: "id2", type: "symbol", value: "ETHUSDT" },
        ],
      },
    ]);
  });

  it("prefers `items` over `symbols` when both are present", () => {
    const out = legacyToWatchlists(
      [{ id: "a", type: "symbol", value: "SOLUSDT" }],
      ["BTCUSDT"],
      counterId(),
    );
    expect(out[0].items).toEqual([{ id: "a", type: "symbol", value: "SOLUSDT" }]);
  });

  it("returns nothing when both legacy columns are empty", () => {
    expect(legacyToWatchlists([], [], counterId())).toEqual([]);
    expect(legacyToWatchlists(null, null, counterId())).toEqual([]);
  });
});

describe("resolveActiveId", () => {
  const lists = [
    { id: "w1", name: "One", items: [] },
    { id: "w2", name: "Two", items: [] },
  ];

  it("keeps a stored id that still names a list", () => {
    expect(resolveActiveId(lists, "w2")).toBe("w2");
  });

  it("falls back to the first list when the stored id is gone", () => {
    expect(resolveActiveId(lists, "deleted-elsewhere")).toBe("w1");
  });

  it("falls back to the first list when there is no stored id", () => {
    expect(resolveActiveId(lists, null)).toBe("w1");
    expect(resolveActiveId(lists, 7)).toBe("w1");
  });

  it("is null with no lists at all", () => {
    expect(resolveActiveId([], "w1")).toBeNull();
  });
});

describe("rowToWatchlists", () => {
  it("adopts a migration-06 row as-is", () => {
    expect(
      rowToWatchlists(
        {
          lists: [
            { id: "w1", name: "Crypto", items: [{ id: "a", type: "symbol", value: "BTCUSDT" }] },
            { id: "w2", name: "Stocks", items: [] },
          ],
          active_id: "w2",
          items: [],
          symbols: [],
        },
        counterId(),
      ),
    ).toEqual({
      lists: [
        { id: "w1", name: "Crypto", items: [{ id: "a", type: "symbol", value: "BTCUSDT" }] },
        { id: "w2", name: "Stocks", items: [] },
      ],
      activeId: "w2",
    });
  });

  it("migrates a pre-06 `items` row into one Default list, active", () => {
    const out = rowToWatchlists(
      {
        lists: [],
        active_id: null,
        items: [{ id: "a", type: "symbol", value: "BTCUSDT" }],
        symbols: ["BTCUSDT"],
      },
      counterId("new"),
    );
    expect(out).toEqual({
      lists: [
        {
          id: "new1",
          name: "Default",
          items: [{ id: "a", type: "symbol", value: "BTCUSDT" }],
        },
      ],
      activeId: "new1",
    });
  });

  it("migrates the oldest `symbols`-only row", () => {
    const out = rowToWatchlists({ symbols: ["BTCUSDT"] }, counterId());
    expect(out?.lists).toHaveLength(1);
    expect(out?.lists[0].name).toBe("Default");
    expect(out?.lists[0].items).toEqual([{ id: "id1", type: "symbol", value: "BTCUSDT" }]);
    expect(out?.activeId).toBe("id2");
  });

  it("ignores the frozen legacy columns once `lists` is populated", () => {
    const out = rowToWatchlists(
      {
        lists: [{ id: "w1", name: "Crypto", items: [] }],
        active_id: "w1",
        items: [{ id: "a", type: "symbol", value: "STALE" }],
        symbols: ["STALE"],
      },
      counterId(),
    );
    expect(out?.lists).toHaveLength(1);
    expect(out?.lists[0].items).toEqual([]);
  });

  it("repairs an active_id pointing at a list that no longer exists", () => {
    const out = rowToWatchlists(
      { lists: [{ id: "w1", name: "Crypto", items: [] }], active_id: "gone" },
      counterId(),
    );
    expect(out?.activeId).toBe("w1");
  });

  it("is null for a row with no watchlist data in any generation", () => {
    expect(rowToWatchlists({ lists: [], active_id: null, items: [], symbols: [] })).toBeNull();
  });

  it("is null when there is no row at all", () => {
    expect(rowToWatchlists(null)).toBeNull();
    expect(rowToWatchlists(undefined)).toBeNull();
  });
});
