import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { shouldHideNavBar } from "./useIsLandscape";
import type { MobileTab } from "@/lib/store/mobile-store";

const TABS: MobileTab[] = ["watchlist", "chart", "trade", "menu"];

describe("shouldHideNavBar", () => {
  it("hides the bar on the Chart tab of a landscape mobile viewport", () => {
    expect(shouldHideNavBar({ isMobile: true, isLandscape: true, tab: "chart" })).toBe(true);
  });

  it("keeps the bar in portrait on the Chart tab", () => {
    expect(shouldHideNavBar({ isMobile: true, isLandscape: false, tab: "chart" })).toBe(false);
  });

  it("keeps the bar on every other tab in landscape", () => {
    expect(shouldHideNavBar({ isMobile: true, isLandscape: true, tab: "watchlist" })).toBe(false);
    expect(shouldHideNavBar({ isMobile: true, isLandscape: true, tab: "trade" })).toBe(false);
    expect(shouldHideNavBar({ isMobile: true, isLandscape: true, tab: "menu" })).toBe(false);
  });

  it("never hides it off mobile (desktop landscape)", () => {
    for (const tab of TABS) {
      expect(shouldHideNavBar({ isMobile: false, isLandscape: true, tab })).toBe(false);
      expect(shouldHideNavBar({ isMobile: false, isLandscape: false, tab })).toBe(false);
    }
  });

  it("is true for exactly one of the 16 combinations", () => {
    let hits = 0;
    for (const isMobile of [true, false])
      for (const isLandscape of [true, false])
        for (const tab of TABS) if (shouldHideNavBar({ isMobile, isLandscape, tab })) hits++;
    expect(hits).toBe(1);
  });
});
