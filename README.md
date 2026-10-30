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
  api/        Hono API, hosted by a thin Next.js app for Vercel Workflows (port 3001; Vercel Functions in bom1)
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
pnpm --filter api dev           # http://localhost:3001/v1/health, /openapi.json (Next.js + Workflows)
pnpm --filter web dev           # http://localhost:3000
pnpm --filter console dev       # http://localhost:3002
```

Mobile apps use development builds (never Expo Go, because calling and SOS need native modules).

Windows, one-time setup for Android builds:
- JDK 17 (`winget install Microsoft.OpenJDK.17`); user env vars `JAVA_HOME` (that JDK), `ANDROID_HOME` (`%LOCALAPPDATA%\Android\Sdk`), and `platform-tools` + `emulator` on `Path`.
- Long paths: native modules compile to paths over 260 characters. Enable them (admin PowerShell: `New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`) and use a long-path-aware CMake/Ninja (`winget install Kitware.CMake Ninja-build.Ninja`); the SDK's CMake 3.22 ships an older Ninja that fails.
- After every `expo prebuild`, point Gradle at that CMake in `apps/<app>/android/local.properties`: `cmake.dir=C\:\\Program Files\\CMake` (with Ninja on `Path`).
- The first native build takes 15–20 minutes; later ones a few minutes, and JS changes reload through Metro without a rebuild.

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
- `.env`: leave `SUPABASE_JWT_SECRET` empty with the current Supabase CLI (it signs tokens with asymmetric keys, verified through JWKS).

### Workflows (SOS escalation)

The API runs durable workflows locally with no extra service; run state lives in `apps/api/.workflow-data`. Inspect runs with `cd apps/api && npx workflow web` (or `npx workflow inspect runs`). Every SOS starts one escalation run: dispatch, widen at 30 s, prompt 108 at 90 s (per-site thresholds).

Simulated crews (local stack, API running): `pnpm --filter api simulate:crews --count 5 --team 2 --sos` puts 5 test crews on duty around Hyderabad (2 in a coverage team), raises a test SOS and accepts offers; Ctrl+C takes them off duty. Options: `--near lat,lng`, `--decline 0.3`, `--drive` with `--speed 100` for a quick run (the winning crew drives to the patient, default ~40 km/h, streaming its position, then steps through on scene → transporting → handed over).

Command center (console home): operations see every incident on `desk:all`; a community desk account (a `community_desk` role with `scope_type = site`) sees only its community on `desk:{siteId}`. With simulated crews on duty, "Run a test SOS" raises a drill for a community (drill crews only, labelled DRILL). Live updates need `SUPABASE_SECRET_KEY` in `.env`; without it the board polls every 10 s.

Live SOS updates: the API pushes state changes and ambulance positions on each incident's private Realtime channel `sos:{id}` when `SUPABASE_SECRET_KEY` is set in `.env`; without it the apps fall back to polling every 5 s. To test the resident SOS screen on the emulator, set a location with `adb emu geo fix 78.35 17.44` and run the simulator with `--near 17.44,78.35 --drive`. To link a test ambulance (registration and work number on the resident's screen), set `crews.ambulance_id` in Studio.

## Checks

```sh
pnpm check       # brand name only in packages/brand; colours/fonts only in packages/tokens
pnpm lint        # ESLint everywhere (includes the token rule) + pnpm check
pnpm typecheck
pnpm test        # unit tests, incl. WCAG AA contrast for every theme and mode, and whole-workflow runs (sleeps fast-forwarded)
pnpm --filter web e2e        # Playwright + axe (E2E_BASE_URL=http://localhost:3000 to reuse a dev server)
pnpm --filter console e2e
maestro test -e DEV_SERVER=http://10.0.2.2:8081 apps/resident/.maestro/sign-in.yaml   # dev build; needs an emulator + local stack
maestro test apps/resident/.maestro/sos-offline.yaml   # SOS with airplane mode on (Android)
```

## Generated files (committed)

- `pnpm assets`: icons, splash screens and favicons from `packages/brand/assets/logo.svg`, coloured from tokens
- `pnpm openapi`: `packages/api-client/openapi.json` and its TypeScript types, from the API routes

CI fails if either is out of date.

## Theming

Components use semantic roles only (`bg-surface`, `text-text-muted`, `bg-service-consult-soft`, `rounded-card`, `useTheme().colors.danger`). A new theme is one file in `packages/tokens/src/themes/` with a light and a dark mode, registered in `packages/tokens/src/index.ts`; the contrast test covers it automatically.

## Renaming

`pnpm rebrand --name "New Name" --domain example.in [--logo new.svg]`, then `docs/rename-checklist.md`.
