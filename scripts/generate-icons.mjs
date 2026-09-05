#!/usr/bin/env node
// Rasterizes public/logo.svg into the PNG icons the PWA manifest and
// apple-touch-icon need (Chromium/Android require PNG, not SVG). Re-run this
// after any visual change to logo.svg.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const source = readFileSync(path.join(publicDir, "logo.svg"), "utf8");

const BG = "#0f0f0f";

// The source SVG's background is the old #000000; every generated icon uses
// the new tv-bg instead.
const flatSvg = source.replace('fill="#000000"', `fill="${BG}"`);

// Maskable icons must be full-bleed (Android applies its own mask shape), so
// drop the source's own rounded-rect background and edge padding, then scale
// the glyph down ~10% so nothing sits in the area a circular mask would clip.
const glyphOnly = flatSvg
  .replace(/<rect width="100" height="100" rx="16" fill="#0f0f0f"\/>\n\n\s*/, "")
  .replace("</svg>", "");
const glyphBody = glyphOnly.slice(glyphOnly.indexOf("</style>") + "</style>".length);
const maskableSvg = flatSvg.slice(0, flatSvg.indexOf("</style>") + "</style>".length) +
  `\n  <rect width="100" height="100" fill="${BG}"/>\n` +
  `  <g transform="translate(50,50) scale(0.9) translate(-50,-50)">${glyphBody}</g>\n` +
  `</svg>\n`;

async function render(svg, size, file) {
  const density = (size / 100) * 96;
  await sharp(Buffer.from(svg), { density })
    .resize(size, size)
    .png()
    .toFile(path.join(publicDir, file));
  const meta = await sharp(path.join(publicDir, file)).metadata();
  console.log(`${file}: ${meta.width}x${meta.height} ${meta.format}`);
}

await render(flatSvg, 192, "icon-192.png");
await render(flatSvg, 512, "icon-512.png");
await render(maskableSvg, 512, "icon-maskable-512.png");
await render(flatSvg, 180, "apple-touch-icon.png");
