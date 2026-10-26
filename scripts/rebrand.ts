// pnpm rebrand --name "New Name" --domain newname.in [--short "Name"] [--legal "..."]
//               [--tagline "..."] [--sms ABCDEF] [--logo path/to/logo.svg]
//
// Updates packages/brand/brand.json (keeping the old name in formerNames so the
// CI brand check keeps blocking it), swaps the logo and regenerates assets.
// Then work through docs/rename-checklist.md: several items need outside approval.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const root = join(import.meta.dirname, '..');
const file = join(root, 'packages/brand/brand.json');

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    short: { type: 'string' },
    legal: { type: 'string' },
    tagline: { type: 'string' },
    domain: { type: 'string' },
    sms: { type: 'string' },
    logo: { type: 'string' },
  },
});

if (!values.name || !values.domain) {
  console.error('Usage: pnpm rebrand --name "New Name" --domain example.in [--short ...] [--legal ...] [--tagline ...] [--sms ABCDEF] [--logo file.svg]');
  process.exit(1);
}

const brand = JSON.parse(readFileSync(file, 'utf8'));
const d = values.domain;
const former = new Set<string>([...brand.formerNames, brand.name, brand.shortName]);
former.delete(values.name);

const next = {
  ...brand,
  name: values.name,
  shortName: values.short ?? values.name,
  legalEntityName: values.legal ?? brand.legalEntityName,
  tagline: values.tagline ?? brand.tagline,
  domains: { primary: d, web: d, console: `console.${d}`, api: `api.${d}`, links: d, email: d },
  support: { ...brand.support, email: `support@${d}` },
  whatsappDisplayName: values.name,
  smsSenderHeader: values.sms ?? brand.smsSenderHeader,
  formerNames: [...former],
  previousDomains: [...new Set([...(brand.previousDomains ?? []), brand.domains.primary])],
};

writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
if (values.logo) copyFileSync(values.logo, join(root, 'packages/brand', brand.logo.source));

execFileSync('pnpm', ['assets'], { cwd: root, stdio: 'inherit', shell: true });

console.log(`\nRebranded to "${next.name}" on ${d}.`);
console.log('Keep the old domain redirecting (previousDomains in brand.json).');
console.log('Next: run `pnpm check`, then work through docs/rename-checklist.md.');
