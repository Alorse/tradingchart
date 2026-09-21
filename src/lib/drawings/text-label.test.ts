import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { TEXT_LABEL_DEFAULTS, resolveTextLabel, supportsTextLabel } from "./text-label";
import type { DrawingKind, HRayDrawing, LongPositionDrawing } from "./types";

describe("TEXT_LABEL_DEFAULTS", () => {
  it("matches TradingView's documented per-tool defaults", () => {
    expect(TEXT_LABEL_DEFAULTS).toEqual({
      hray: { fontSize: 12, horzTextAlign: "center", vertTextAlign: "top" },
      hline: { fontSize: 12, horzTextAlign: "center", vertTextAlign: "top" },
      trendline: { fontSize: 14, horzTextAlign: "center", vertTextAlign: "bottom" },
      ray: { fontSize: 14, horzTextAlign: "center", vertTextAlign: "bottom" },
      arrow: { fontSize: 14, horzTextAlign: "center", vertTextAlign: "bottom" },
      rectangle: { fontSize: 14, horzTextAlign: "left", vertTextAlign: "bottom" },
      vline: { fontSize: 14, horzTextAlign: "right", vertTextAlign: "top" },
    });
  });

  it("only the seven line tools support a text label", () => {
    const withText: DrawingKind[] = ["hray", "hline", "vline", "trendline", "ray", "arrow", "rectangle"];
    const without: DrawingKind[] = [
      "brush", "highlighter", "long", "short", "pitchfork", "xabcd", "parallel-channel",
      "price-range", "date-range", "fib-retracement", "fib-extension", "text", "callout",
    ];
    for (const k of withText) expect(supportsTextLabel(k)).toBe(true);
    for (const k of without) expect(supportsTextLabel(k)).toBe(false);
  });
});

describe("resolveTextLabel", () => {
  const hray: HRayDrawing = { id: "h", symbol: "X", kind: "hray", anchor: { time: 1, price: 1 } };

  it("fills the kind's defaults, text off and colour following the line", () => {
    expect(resolveTextLabel(hray, "#2962ff")).toEqual({
      showText: false,
      text: "",
      textColor: "#2962ff",
      fontSize: 12,
      bold: false,
      italic: false,
      horzTextAlign: "center",
      vertTextAlign: "top",
    });
  });

  it("keeps explicitly set fields", () => {
    const r = resolveTextLabel(
      { ...hray, showText: true, text: "hi", textColor: "#fff", fontSize: 20, horzTextAlign: "left" },
      "#000",
    );
    expect(r?.textColor).toBe("#fff");
    expect(r?.fontSize).toBe(20);
    expect(r?.horzTextAlign).toBe("left");
    expect(r?.vertTextAlign).toBe("top");
  });

  it("returns null for kinds without text support", () => {
    const long = {
      id: "l", symbol: "X", kind: "long", entry: 1, stop: 0, target: 2, timeA: 0, timeB: 1,
    } as LongPositionDrawing;
    expect(resolveTextLabel(long, "#000")).toBe(null);
  });
});
