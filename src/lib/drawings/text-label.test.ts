import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  TEXT_LABEL_DEFAULTS,
  boxLabelPlacement,
  labelBounds,
  lineLabelPlacement,
  resolveTextLabel,
  supportsTextLabel,
} from "./text-label";
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

describe("lineLabelPlacement", () => {
  // Horizontal span x 0→200 at y=100; fontSize 10 → lineHeight 12; pad 6, gap 4.
  const p1 = { x: 0, y: 100 };
  const p2 = { x: 200, y: 100 };
  const cases = [
    { horz: "left", x: 6, anchor: "start" },
    { horz: "center", x: 100, anchor: "middle" },
    { horz: "right", x: 194, anchor: "end" },
  ] as const;
  const verts = [
    { vert: "top", dy: -10 }, // gap 4 + half a line (6) above the line
    { vert: "middle", dy: 0 },
    { vert: "bottom", dy: 10 },
  ] as const;

  for (const h of cases) {
    for (const v of verts) {
      it(`${h.horz} × ${v.vert}`, () => {
        const p = lineLabelPlacement(p1, p2, h.horz, v.vert, 10, 1);
        expect(p.x).toBeCloseTo(h.x, 6);
        expect(p.y).toBeCloseTo(100, 6);
        expect(p.angle).toBe(0);
        expect(p.textAnchor).toBe(h.anchor);
        expect(p.firstLineDy).toBeCloseTo(v.dy, 6);
        expect(p.lineHeight).toBeCloseTo(12, 6);
      });
    }
  }

  it("is independent of endpoint order (always reads upright)", () => {
    expect(lineLabelPlacement(p2, p1, "left", "top", 10, 1)).toEqual(
      lineLabelPlacement(p1, p2, "left", "top", 10, 1),
    );
  });

  it("rotates along a sloped line, keeping the text upright", () => {
    // Up-and-right on screen (y decreases): -45°.
    const p = lineLabelPlacement({ x: 0, y: 100 }, { x: 100, y: 0 }, "center", "top", 10, 1);
    expect(p.angle).toBeCloseTo(-45, 6);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(50, 6);
    // Down-and-left is the same line, flipped so it still reads left→right.
    const q = lineLabelPlacement({ x: 100, y: 0 }, { x: 0, y: 100 }, "center", "top", 10, 1);
    expect(q.angle).toBeCloseTo(-45, 6);
  });

  it("reads a vertical line bottom→top: right = top end", () => {
    const p = lineLabelPlacement({ x: 50, y: 0 }, { x: 50, y: 300 }, "right", "top", 10, 1);
    expect(p.angle).toBe(-90);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(6, 6);
    const q = lineLabelPlacement({ x: 50, y: 0 }, { x: 50, y: 300 }, "left", "top", 10, 1);
    expect(q.y).toBeCloseTo(294, 6);
  });

  it("applies startInset only to a start-aligned label", () => {
    expect(lineLabelPlacement(p1, p2, "left", "top", 10, 1, { startInset: 90 }).x).toBeCloseTo(96, 6);
    expect(lineLabelPlacement(p1, p2, "center", "top", 10, 1, { startInset: 90 }).x).toBeCloseTo(100, 6);
    expect(lineLabelPlacement(p1, p2, "right", "top", 10, 1, { startInset: 90 }).x).toBeCloseTo(194, 6);
  });

  it("stacks a multi-line block so its edge keeps the same clearance", () => {
    // 3 lines, lh 12: top block's LAST line centre at -10, first at -34.
    expect(lineLabelPlacement(p1, p2, "center", "top", 10, 3).firstLineDy).toBeCloseTo(-34, 6);
    expect(lineLabelPlacement(p1, p2, "center", "middle", 10, 3).firstLineDy).toBeCloseTo(-12, 6);
    expect(lineLabelPlacement(p1, p2, "center", "bottom", 10, 3).firstLineDy).toBeCloseTo(10, 6);
  });

  it("does not produce NaN for a zero-length segment", () => {
    const p = lineLabelPlacement({ x: 5, y: 5 }, { x: 5, y: 5 }, "left", "top", 10, 1);
    expect(p.angle).toBe(0);
    expect(p.x).toBeCloseTo(11, 6);
    expect(p.y).toBeCloseTo(5, 6);
  });
});

describe("boxLabelPlacement", () => {
  // Box x 0→200, y 0→100 (corners in reverse order), pad 6, fontSize 10.
  const a = { x: 200, y: 100 };
  const b = { x: 0, y: 0 };

  it("places the label inside the box for each alignment", () => {
    const tl = boxLabelPlacement(a, b, "left", "top", 10, 1);
    expect(tl.x).toBe(6);
    expect(tl.textAnchor).toBe("start");
    expect(tl.y + tl.firstLineDy).toBeCloseTo(12, 6); // 6 pad + 6 half-line
    const mc = boxLabelPlacement(a, b, "center", "middle", 10, 1);
    expect(mc.x).toBe(100);
    expect(mc.y + mc.firstLineDy).toBeCloseTo(50, 6);
    const br = boxLabelPlacement(a, b, "right", "bottom", 10, 2);
    expect(br.x).toBe(194);
    expect(br.textAnchor).toBe("end");
    // Last of two lines centred at 100 - 6 - 6 = 88, first one line above.
    expect(br.y + br.firstLineDy).toBeCloseTo(76, 6);
    expect(br.angle).toBe(0);
  });
});

describe("labelBounds", () => {
  it("covers the text block on the anchor's side", () => {
    const p = lineLabelPlacement({ x: 0, y: 0 }, { x: 200, y: 0 }, "right", "top", 10, 2);
    const box = labelBounds(p, ["abcd", "ab"], 10);
    expect(box.width).toBeCloseTo(24.8, 6);
    expect(box.x).toBeCloseTo(-24.8, 6);
    expect(box.height).toBeCloseTo(24, 6);
    // Block bottom sits `gap` (4) above the line.
    expect(box.y + box.height).toBeCloseTo(-4, 6);
  });
});
