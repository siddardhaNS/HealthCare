// CI check: no raw hex colours or font-family names outside packages/tokens.
// Covers CSS, JSON and other files ESLint does not see.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoTextFiles } from './lib/files';

const root = join(import.meta.dirname, '..');

const SCOPE = /^(apps|packages)\//;
// packages/config/eslint defines the matching lint rule, so it names the fonts.
const ALLOWED = [/^packages\/tokens\//, /^packages\/config\/eslint\//, /\/generated\//, /^packages\/brand\/assets\//, /(^|\/)package\.json$/, /\.md$/];
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FONT = /\b(?:Sora|DM Sans|Inter|Space Grotesk|Plus Jakarta Sans|JetBrains Mono|IBM Plex Mono|Roboto|Helvetica|Arial)\b/;

const hits: string[] = [];
for (const file of repoTextFiles(root)) {
  if (!SCOPE.test(file) || ALLOWED.some((re) => re.test(file))) continue;
  const path = join(root, file);
  if (!existsSync(path)) continue;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (HEX.test(line) || FONT.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}

if (hits.length) {
  console.error(`Raw colours or font names outside packages/tokens (${hits.length}). Use semantic tokens:\n` + hits.join('\n'));
  process.exit(1);
}
console.log('token check: ok');
