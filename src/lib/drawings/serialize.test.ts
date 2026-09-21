import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { drawingToRow, rowToDrawing } from "./serialize";
import type { HRayDrawing, LongPositionDrawing, RectangleDrawing } from "./types";

describe("drawingToRow / rowToDrawing", () => {
  it("round-trips a long position's new sizing/style/display fields through the JSONB data column", () => {
    const drawing: LongPositionDrawing = {
      id: "d1",
      symbol: "BTCUSDT",
      kind: "long",
      entry: 100,
      stop: 90,
      target: 120,
      timeA: 10,
      timeB: 20,
      color: "#ffffff",
      stopColor: "#ef5350",
      targetColor: "#26a69a",
      textColor: "#d1d4dc",
      textSize: 12,
      stopLineWidth: 2,
      stopLineStyle: 1,
      targetLineWidth: 2,
      targetLineStyle: 2,
      accountSize: 10000,
      risk: 2,
      riskIsPercent: true,
      leverage: 5,
      lotSize: 1,
      qtyPrecision: 3,
      ticksTarget: 200,
      ticksStop: 100,
      alwaysShowStats: true,
      compactStats: true,
      statsOverrides: { openPnl: false, balance: true },
      priceLabels: true,
      showRMultiples: true,
      alert: null,
    };

    const row = drawingToRow(drawing);
    expect(row.id).toBe("d1");
    expect(row.symbol).toBe("BTCUSDT");
    expect(row.kind).toBe("long");
    // Column fields don't leak into the JSONB payload
    expect((row.data as Record<string, unknown>).id).toBe(undefined);
    expect((row.data as Record<string, unknown>).symbol).toBe(undefined);
    expect((row.data as Record<string, unknown>).kind).toBe(undefined);

    const restored = rowToDrawing({
      id: row.id,
      symbol: row.symbol,
      kind: row.kind,
      data: row.data,
      alert: row.alert,
    });

    expect(restored).toEqual(drawing);
  });

  it("round-trips the text-label fields with no schema change (they ride in `data`)", () => {
    const hray: HRayDrawing = {
      id: "h1",
      symbol: "BYBIT:SOLUSDT.P",
      kind: "hray",
      anchor: { time: 100, price: 150.5 },
      color: "#2962ff",
      showText: true,
      text: "Weekly high\nretest",
      textColor: "#f23645",
      fontSize: 12,
      bold: true,
      italic: false,
      horzTextAlign: "right",
      vertTextAlign: "bottom",
      alert: null,
    };
    const rect: RectangleDrawing = {
      id: "r1",
      symbol: "BTCUSDT",
      kind: "rectangle",
      a: { time: 1, price: 10 },
      b: { time: 2, price: 20 },
      showText: false,
      text: "",
      horzTextAlign: "left",
      vertTextAlign: "middle",
      alert: null,
    };
    for (const d of [hray, rect]) {
      const row = drawingToRow(d);
      const data = row.data as Record<string, unknown>;
      expect(data.text).toBe(d.text);
      expect(data.showText).toBe(d.showText);
      expect(rowToDrawing(row)).toEqual(d);
    }
  });

  it("a legacy row without text fields restores without them", () => {
    const restored = rowToDrawing({
      id: "h2",
      symbol: "BTCUSDT",
      kind: "hray",
      data: { anchor: { time: 1, price: 2 }, color: "#fff" },
      alert: null,
    }) as HRayDrawing;
    expect(restored.showText).toBe(undefined);
    expect(restored.text).toBe(undefined);
  });
});
