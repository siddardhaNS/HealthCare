import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tailwindCss, themeCss } from '../src/css';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'theme.css'), themeCss());
writeFileSync(join(dist, 'tailwind.css'), tailwindCss());
console.log('tokens: wrote dist/theme.css and dist/tailwind.css');
