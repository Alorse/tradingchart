import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { isMobileViewport, narrowViewportQuery } from "./useIsMobile";

const touch = (width: number, height: number) => ({ width, height, coarsePointer: true });
const mouse = (width: number, height: number) => ({ width, height, coarsePointer: false });

describe("isMobileViewport", () => {
  it("iPhone 14 portrait (390×844, coarse) is mobile", () => {
    expect(isMobileViewport(touch(390, 844))).toBe(true);
  });

  it("iPhone 14 landscape (844×390, coarse) is mobile", () => {
    expect(isMobileViewport(touch(844, 390))).toBe(true);
  });

  it("Pixel 7 landscape (915×412, coarse) is mobile", () => {
    expect(isMobileViewport(touch(915, 412))).toBe(true);
  });

  it("largest-phone landscape (956×440, coarse) is mobile", () => {
    expect(isMobileViewport(touch(956, 440))).toBe(true);
  });

  it("iPad portrait (820×1180, coarse) is not mobile", () => {
    expect(isMobileViewport(touch(820, 1180))).toBe(false);
  });

  it("iPad mini landscape (1133×744, coarse) is not mobile", () => {
    expect(isMobileViewport(touch(1133, 744))).toBe(false);
  });

  it("narrow desktop window (700×900, fine) is mobile", () => {
    expect(isMobileViewport(mouse(700, 900))).toBe(true);
  });

  it("short desktop window (1440×500, fine) is not mobile", () => {
    expect(isMobileViewport(mouse(1440, 500))).toBe(false);
  });

  it("large desktop (1920×1080, fine) is not mobile", () => {
    expect(isMobileViewport(mouse(1920, 1080))).toBe(false);
  });

  it("the width breakpoint is exclusive at 768", () => {
    expect(isMobileViewport(mouse(767, 900))).toBe(true);
    expect(isMobileViewport(mouse(768, 900))).toBe(false);
  });

  it("the height threshold is exclusive at 600", () => {
    expect(isMobileViewport(touch(1024, 599))).toBe(true);
    expect(isMobileViewport(touch(1024, 600))).toBe(false);
  });
});

describe("narrowViewportQuery", () => {
  it("matches strictly below the breakpoint", () => {
    expect(narrowViewportQuery()).toBe("(max-width: 767px)");
    expect(narrowViewportQuery(640)).toBe("(max-width: 639px)");
  });
});
