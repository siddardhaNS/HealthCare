// Generates every app icon, splash image and favicon from the one source logo
// (packages/brand/assets/logo.svg), colouring it from design tokens. A new
// logo is a one-file swap followed by `pnpm assets`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import brand from '../packages/brand/brand.json' with { type: 'json' };
import { resolveTheme } from '../packages/tokens/src/index';

const root = join(import.meta.dirname, '..');
const template = readFileSync(join(root, 'packages/brand', brand.logo.source), 'utf8');
const dark = resolveTheme('aurora', 'dark').colors;
const light = resolveTheme('aurora', 'light').colors;

function svg(vars: { bg: string; accent: string }) {
  return Buffer.from(template.replace(/\{\{(\w+)\}\}/g, (_, k: keyof typeof vars) => vars[k]));
}

const full = svg({ bg: dark.bg, accent: dark.accent });
// Transparent mark for adaptive icons and splash screens (background comes from tokens).
const mark = svg({ bg: 'none', accent: dark.accent });

async function png(input: Buffer, size: number, file: string, padding = 0) {
  const inner = size - padding * 2;
  const img = await sharp(input, { density: 384 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, left: padding, top: padding }])
    .png()
    .toFile(file);
}

for (const app of ['resident', 'field']) {
  const out = join(root, 'apps', app, 'assets', 'generated');
  mkdirSync(out, { recursive: true });
  await png(full, 1024, join(out, 'icon.png'));
  await png(mark, 1024, join(out, 'adaptive-icon.png'), 192);
  await png(mark, 512, join(out, 'splash.png'));
  // app.config.ts runs outside Metro and cannot import TS packages, so the
  // native config reads token colours from this generated file.
  writeFileSync(
    join(out, 'theme.json'),
    JSON.stringify({ dark: { bg: dark.bg, accent: dark.accent }, light: { bg: light.bg, accent: light.accent } }, null, 2) + '\n',
  );
}

for (const app of ['web', 'console']) {
  const out = join(root, 'apps', app, 'public', 'generated');
  mkdirSync(out, { recursive: true });
  await png(full, 64, join(out, 'favicon.png'));
  await png(full, 180, join(out, 'apple-touch-icon.png'));
  await png(full, 512, join(out, 'icon-512.png'));
}

console.log('assets: generated icons, splash images and favicons from', brand.logo.source);
