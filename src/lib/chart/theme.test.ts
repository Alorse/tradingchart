import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { TV_DARK, type TvColors } from "./theme";

/**
 * The palette is necessarily written twice — `globals.css` (Tailwind's `@theme`
 * needs static values, and SSR paints before any JS runs) and `TV_DARK` (the
 * canvas can't consume `var()`, and there is no `document` on the server).
 * These tests are what keeps the second copy honest, instead of the doc
 * comment's "keep it in sync".
 */

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/** The `--tv-*` declarations inside one selector's block. */
function ramp(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/(--tv-[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/** `borderStrong` → `--tv-border-strong`, matching `CSS_VAR`'s naming. */
function cssVar(key: keyof TvColors): string {
  return `--tv-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

describe("TV_DARK vs globals.css", () => {
  it("matches the `:root` ramp value for value", () => {
    const root = ramp(":root");
    for (const key of Object.keys(TV_DARK) as (keyof TvColors)[]) {
      expect(root[cssVar(key)]).toBe(TV_DARK[key]);
    }
  });

  it("covers every `--tv-*` the stylesheet defines", () => {
    const declared = Object.keys(ramp(":root")).sort();
    const mirrored = (Object.keys(TV_DARK) as (keyof TvColors)[]).map(cssVar).sort();
    expect(mirrored).toEqual(declared);
  });

  it("gives `.light` the whole ramp, so a theme swap can't miss a name", () => {
    // The shadcn tokens resolve through these, so a name left undefined here
    // would silently keep its dark value under a light root.
    expect(Object.keys(ramp(".light")).sort()).toEqual(Object.keys(ramp(":root")).sort());
  });
});
