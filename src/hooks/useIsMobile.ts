"use client";

import { useEffect, useState } from "react";

/** Width below which any viewport counts as mobile (Tailwind's `md`). */
export const MOBILE_BREAKPOINT = 768;

/**
 * Height below which a touch device counts as mobile even when it is wider
 * than `MOBILE_BREAKPOINT` — i.e. a phone rotated to landscape (844×390,
 * 915×412, up to ~956×440 on the largest phones). Tablets stay clear of it:
 * the smallest iPad is 744px tall in landscape.
 */
export const MOBILE_MAX_HEIGHT = 600;

/** Media query for "narrower than `breakpoint`" — width only. */
export function narrowViewportQuery(breakpoint = MOBILE_BREAKPOINT): string {
  return `(max-width: ${breakpoint - 1}px)`;
}

const SHORT_VIEWPORT_QUERY = `(max-height: ${MOBILE_MAX_HEIGHT - 1}px)`;
const COARSE_POINTER_QUERY = "(pointer: coarse)";

export interface ViewportInfo {
  width: number;
  height: number;
  /** Primary pointer is coarse (touch). DevTools device emulation reports this too. */
  coarsePointer: boolean;
}

/**
 * Whether the app should render the mobile shell.
 *
 * A narrow window is mobile regardless of pointer (unchanged behaviour —
 * includes a narrow desktop browser). A wide-but-short viewport is mobile only
 * with a coarse pointer, so a landscape phone stays in the mobile UI while a
 * merely short desktop window (fine pointer) keeps the desktop layout.
 */
export function isMobileViewport({ width, height, coarsePointer }: ViewportInfo): boolean {
  return width < MOBILE_BREAKPOINT || (coarsePointer && height < MOBILE_MAX_HEIGHT);
}

/**
 * Synchronous read of `isMobileViewport` against the live window, for code
 * that runs before `useIsMobile`'s state has settled (e.g. a mount effect
 * configuring an imperative widget). Client-only.
 */
export function readIsMobileViewport(): boolean {
  return isMobileViewport({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia(COARSE_POINTER_QUERY).matches,
  });
}

/**
 * Reactive "render the mobile shell" check — see `isMobileViewport`.
 * Re-evaluates on rotation: the width, height and pointer queries each fire
 * `change` when crossed.
 *
 * SSR-safe: returns `false` on the server and on the first client render, then
 * the real value after mount — no hydration mismatch.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const coarse = window.matchMedia(COARSE_POINTER_QUERY);
    const mqls = [window.matchMedia(narrowViewportQuery()), window.matchMedia(SHORT_VIEWPORT_QUERY), coarse];
    const update = () => setIsMobile(readIsMobileViewport());
    update();
    mqls.forEach((m) => m.addEventListener("change", update));
    return () => mqls.forEach((m) => m.removeEventListener("change", update));
  }, []);

  return isMobile;
}

/**
 * Width-only check — true when the viewport is narrower than `breakpoint`.
 * For sizing decisions that depend on horizontal room rather than on which
 * shell is showing (the `sm` full-screen dialog, which a landscape phone must
 * not get).
 */
export function useIsNarrowViewport(breakpoint = MOBILE_BREAKPOINT): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(narrowViewportQuery(breakpoint));
    const update = () => setNarrow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpoint]);

  return narrow;
}
