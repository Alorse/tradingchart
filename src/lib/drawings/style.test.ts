import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { pickStyle, SETTINGS_STYLE_FIELDS, styleOf, TEMPLATE_STYLE_FIELDS } from "./style";
import type { HRayDrawing } from "./types";

const TEXT_APPEARANCE = [
  "showText",
  "textColor",
  "fontSize",
  "bold",
  "italic",
  "horzTextAlign",
  "vertTextAlign",
];

describe("style field lists", () => {
  it("both lists include every text-label appearance field", () => {
    for (const f of TEXT_APPEARANCE) {
      expect(TEMPLATE_STYLE_FIELDS as readonly string[]).toContain(f);
      expect(SETTINGS_STYLE_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("neither list includes the label string itself", () => {
    expect((TEMPLATE_STYLE_FIELDS as readonly string[]).includes("text")).toBe(false);
    expect((SETTINGS_STYLE_FIELDS as readonly string[]).includes("text")).toBe(false);
  });

  it("styleOf carries a labelled line's appearance but not its caption", () => {
    const d: HRayDrawing = {
      id: "h",
      symbol: "BTCUSDT",
      kind: "hray",
      anchor: { time: 1, price: 100 },
      color: "#2962ff",
      showText: true,
      text: "Resistance",
      textColor: "#f23645",
      fontSize: 16,
      bold: true,
      italic: true,
      horzTextAlign: "right",
      vertTextAlign: "bottom",
    };
    expect(styleOf(d)).toEqual({
      color: "#2962ff",
      textColor: "#f23645",
      fontSize: 16,
      showText: true,
      bold: true,
      italic: true,
      horzTextAlign: "right",
      vertTextAlign: "bottom",
    });
    expect(pickStyle(d, SETTINGS_STYLE_FIELDS).text).toBe(undefined);
  });
});
