import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { shouldHideNavBar } from "./useIsLandscape";
import { isMobileViewport } from "./useIsMobile";
import type { MobileTab } from "@/lib/store/mobile-store";

const TABS: MobileTab[] = ["watchlist", "chart", "trade", "menu"];
const touch = { isMobile: true, coarsePointer: true };

describe("shouldHideNavBar", () => {
  it("hides the bar on the Chart tab of a landscape touch viewport", () => {
    expect(shouldHideNavBar({ ...touch, isLandscape: true, tab: "chart" })).toBe(true);
  });

  it("keeps the bar in portrait on the Chart tab", () => {
    expect(shouldHideNavBar({ ...touch, isLandscape: false, tab: "chart" })).toBe(false);
  });

  it("keeps the bar on every other tab in landscape", () => {
    expect(shouldHideNavBar({ ...touch, isLandscape: true, tab: "watchlist" })).toBe(false);
    expect(shouldHideNavBar({ ...touch, isLandscape: true, tab: "trade" })).toBe(false);
    expect(shouldHideNavBar({ ...touch, isLandscape: true, tab: "menu" })).toBe(false);
  });

  it("never hides it off mobile (desktop landscape)", () => {
    for (const coarsePointer of [true, false])
      for (const tab of TABS) {
        expect(shouldHideNavBar({ isMobile: false, coarsePointer, isLandscape: true, tab })).toBe(false);
        expect(shouldHideNavBar({ isMobile: false, coarsePointer, isLandscape: false, tab })).toBe(false);
      }
  });

  it("keeps the bar in a 700x500 desktop window with a mouse", () => {
    const viewport = { width: 700, height: 500, coarsePointer: false };
    // Precondition: the window really is in the mobile shell and landscape.
    expect(isMobileViewport(viewport)).toBe(true);
    expect(viewport.width > viewport.height).toBe(true);
    expect(
      shouldHideNavBar({
        isMobile: isMobileViewport(viewport),
        coarsePointer: viewport.coarsePointer,
        isLandscape: viewport.width > viewport.height,
        tab: "chart",
      }),
    ).toBe(false);
  });

  it("hides it on a landscape iPhone (844x390, touch)", () => {
    const viewport = { width: 844, height: 390, coarsePointer: true };
    expect(
      shouldHideNavBar({
        isMobile: isMobileViewport(viewport),
        coarsePointer: viewport.coarsePointer,
        isLandscape: viewport.width > viewport.height,
        tab: "chart",
      }),
    ).toBe(true);
  });

  it("is true for exactly one of the 32 combinations", () => {
    let hits = 0;
    for (const isMobile of [true, false])
      for (const coarsePointer of [true, false])
        for (const isLandscape of [true, false])
          for (const tab of TABS)
            if (shouldHideNavBar({ isMobile, coarsePointer, isLandscape, tab })) hits++;
    expect(hits).toBe(1);
  });
});
