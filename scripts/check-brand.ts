// CI check: the brand name (current and former) may only appear inside
// packages/brand. Copy uses {{brand}}; code and infrastructure use neutral names.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import brand from '../packages/brand/brand.json' with { type: 'json' };
import { repoTextFiles } from './lib/files';

const root = join(import.meta.dirname, '..');

// design/ holds the reference files supplied with the brief, kept verbatim.
const ALLOWED = [/^packages\/brand\//, /^design\//];

const names = [...new Set([brand.name, brand.shortName, ...brand.formerNames])];
// Catch spacing, casing, hyphen and underscore variants of each name.
const patterns = names.map((n) => {
  const words = n.split(/(?=[A-Z])|\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(words.join('[\\s_-]?'), 'i');
});

const hits: string[] = [];
for (const file of repoTextFiles(root)) {
  if (ALLOWED.some((re) => re.test(file))) continue;
  const path = join(root, file);
  if (!existsSync(path)) continue;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (patterns.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}

if (hits.length) {
  console.error(`Brand name found outside packages/brand (${hits.length}). Use {{brand}} in copy or @repo/brand in code:\n` + hits.join('\n'));
  process.exit(1);
}
console.log(`brand check: ok (${names.join(', ')})`);
