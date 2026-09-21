import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { TEXT_LABEL_DEFAULTS, supportsTextLabel } from "./text-label";
import type { DrawingKind } from "./types";

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
