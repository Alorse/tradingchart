"use client";

import { useEffect, useState } from "react";

/**
 * Reactive viewport-width check. Returns true when the window is at-or-below
 * the mobile breakpoint (768 px by default — Tailwind's `md`).
 *
 * SSR-safe: returns `false` during the first render on the server and the
 * initial client render, then re-renders with the real value after mount.
 * This avoids hydration mismatches while keeping the component reactive.
 */
export const MOBILE_BREAKPOINT = 768;

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}
