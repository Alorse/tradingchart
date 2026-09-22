"use client";

import { useEffect, useState } from "react";
import type { MobileTab } from "@/lib/store/mobile-store";

const LANDSCAPE_QUERY = "(orientation: landscape)";

/**
 * Reactive viewport-orientation check (`(orientation: landscape)`, i.e. wider
 * than tall). Derived on every change, never stored.
 *
 * SSR-safe the same way as `useIsMobile`: `false` on the server and the first
 * client render, the real value after mount.
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const update = () => setLandscape(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return landscape;
}

/**
 * Whether the mobile shell drops its bottom tab bar to give the chart the
 * height. Only on the Chart tab: with the bar gone there is no way to switch
 * tabs, and the other screens gain nothing from the extra room, so hiding it
 * there would just strand the user until they rotate back.
 *
 * Touch only (`coarsePointer`): a narrow desktop window (700×500 with a mouse)
 * is both mobile and landscape, but it isn't a rotated phone — nobody there is
 * short of height, and losing the tab bar would leave no way to switch tabs.
 */
export function shouldHideNavBar({
  isMobile,
  coarsePointer,
  isLandscape,
  tab,
}: {
  isMobile: boolean;
  coarsePointer: boolean;
  isLandscape: boolean;
  tab: MobileTab;
}): boolean {
  return isMobile && coarsePointer && isLandscape && tab === "chart";
}
