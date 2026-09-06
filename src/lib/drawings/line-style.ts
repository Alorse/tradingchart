/**
 * The one translation from a drawing's `lineStyle` discriminator to an SVG
 * `stroke-dasharray`. Every `*Draw.tsx` renderer used to inline the same
 * `style === 1 ? "6 4" : style === 2 ? "2 4" : …` ternary — ten copies that
 * had already drifted on the solid case (`undefined` in some, `"none"` in
 * others; both render solid, so nothing ever caught it).
 *
 * Lives here rather than in a component because the `0 | 1 | 2` union it
 * switches on is defined next door in `types.ts`.
 */
export function lineDash(style: 0 | 1 | 2 | undefined): string | undefined {
  return style === 1 ? "6 4" : style === 2 ? "2 4" : undefined;
}
