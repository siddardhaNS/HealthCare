// Writes the OpenAPI document to packages/api-client so the typed client
// can be generated from it.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app';

const res = await createApp().request('/openapi.json');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'api-client', 'openapi.json');
writeFileSync(out, JSON.stringify(await res.json(), null, 2) + '\n');
console.log(`openapi: wrote ${out}`);
