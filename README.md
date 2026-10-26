# Home-healthcare platform

One TypeScript monorepo for the resident and field apps (Expo, Android + iOS), the console and landing site (Next.js on Vercel), and the API (Hono on Vercel Functions, `bom1`). Data lives in Supabase Mumbai (`ap-south-1`).

The brief is `design/build-brief.pdf`; the design reference is the Aurora HTML file in `design/`. Progress and open questions are in `docs/progress.md`.

## Layout

```
apps/
  resident/   Expo app: residents and families
  field/      Expo app: crew, phlebotomists, companions, riders
  console/    Next.js: admin console + partner portal (port 3002)
  web/        Next.js: landing site (port 3000)
  api/        Hono API (port 3001 locally; Vercel Functions in bom1)
packages/
  brand/      the only place the product name, domains, contacts and logo live
  tokens/     design tokens (Aurora light + dark), CSS/Tailwind output, contrast test
  i18n/       English, Telugu, Hindi strings; {{brand}} interpolation; rupee formatting
  contracts/  Zod schemas, source of the OpenAPI spec
  api-client/ typed client generated from the OpenAPI spec
  db/         Drizzle mirror of the Supabase schema
  ui-native/  React Native components + ThemeProvider
  ui-web/     shadcn-style web components + ThemeProvider
  config/     TypeScript and ESLint presets; permanent app IDs
supabase/     local Supabase config, SQL migrations (source of truth for DDL + RLS), seed
scripts/      brand/token checks, asset generation, rebrand
```

## Prerequisites

- Node 24, pnpm 12 (`npm i -g pnpm@12`)
- Docker Desktop running, for the local Supabase stack
- Android: Android Studio (SDK + an emulator) and JDK 17
- iOS: a Mac with Xcode 16+ (iOS simulators only run on macOS). From Windows, use an EAS development build on a real iPhone instead.

## Run locally

```sh
pnpm install
cp .env.example .env            # API secrets; fill in from `pnpm supabase status`
cp supabase/.env.example supabase/.env      # same SEND_SMS_HOOK_SECRET
cp apps/console/.env.example apps/console/.env.local
cp apps/resident/.env.example apps/resident/.env   # likewise apps/field

pnpm supabase start             # Postgres + PostGIS, Auth, Storage, Realtime
pnpm --filter api dev           # http://localhost:3001/v1/health, /openapi.json
pnpm --filter web dev           # http://localhost:3000
pnpm --filter console dev       # http://localhost:3002
```

Mobile apps use development builds (never Expo Go, because calling and SOS need native modules):

```sh
cd apps/resident
pnpm android                    # expo run:android: builds and installs on the emulator
pnpm ios                        # expo run:ios: macOS only
pnpm dev                        # Metro for an installed dev build
# Or in the cloud: npx eas build --profile development --platform android|ios
```

### Accounts for local testing

- Residents / field staff: test numbers +91 99999 00001 and +91 99999 00002, code `123456` (no message is sent).
- Give the field number a role: insert into `user_roles` (e.g. `crew`) via `pnpm supabase db` / Studio.
- Console staff: `pnpm --filter api staff:create --email you@example.in --role super_admin`, then set up TOTP on first sign-in.

## Checks

```sh
pnpm check       # brand name only in packages/brand; colours/fonts only in packages/tokens
pnpm lint        # ESLint everywhere (includes the token rule) + pnpm check
pnpm typecheck
pnpm test        # unit tests, incl. WCAG AA contrast for every theme and mode
pnpm --filter web e2e        # Playwright + axe (E2E_BASE_URL=http://localhost:3000 to reuse a dev server)
pnpm --filter console e2e
maestro test apps/resident/.maestro/sign-in.yaml   # needs an emulator + local stack
```

## Generated files (committed)

- `pnpm assets`: icons, splash screens and favicons from `packages/brand/assets/logo.svg`, coloured from tokens
- `pnpm openapi`: `packages/api-client/openapi.json` and its TypeScript types, from the API routes

CI fails if either is out of date.

## Theming

Components use semantic roles only (`bg-surface`, `text-text-muted`, `bg-service-consult-soft`, `rounded-card`, `useTheme().colors.danger`). A new theme is one file in `packages/tokens/src/themes/` with a light and a dark mode, registered in `packages/tokens/src/index.ts`; the contrast test covers it automatically.

## Renaming

`pnpm rebrand --name "New Name" --domain example.in [--logo new.svg]`, then `docs/rename-checklist.md`.
