# Progress

## 2026-10-26 · Phase 1 (Foundations), session 1: monorepo scaffold

### Done

- **Monorepo**: pnpm 12 workspaces + Turborepo 2.11, laid out as in the brief (`apps/{resident,field,console,web,api}`, `packages/{brand,contracts,api-client,db,tokens,ui-native,ui-web,config,i18n}`, `supabase/`, `design/`). Neutral names everywhere (`@repo/*`, `resident`, `field`, `console`, `web`, `api`).
- **Brand**: `packages/brand/brand.json` is the only place the name, domains, contacts, WhatsApp name, SMS header and logo live. `pnpm rebrand` updates it, keeps the old name in `formerNames` (still blocked by CI) and the old domain in `previousDomains`, then regenerates assets. `pnpm check` fails on the name anywhere outside `packages/brand` and `design/`, including spacing, case and hyphen variants. `docs/rename-checklist.md` written.
- **Design tokens (Aurora)**: dark values copied from the three `themes()` objects in the Aurora design file. Semantic roles cover surfaces, text, accent, status (danger/warning/success/info), five service colours, map styling and the heatmap ramp, plus fonts (Sora / DM Sans / JetBrains Mono), radii (22–26 px for large containers), spacing, type scale and 44 px tap target. Outputs: TS objects for native, CSS variables + a Tailwind v4 `@theme` (default palette cleared, so only semantic utilities exist).
- **Token guards**: an ESLint rule fails on hex colours or font names outside `packages/tokens`; `scripts/check-tokens.ts` does the same for CSS/JSON. A contrast test checks 38 foreground/background pairs for WCAG AA in each theme and mode.
- **Theme providers**: `@repo/ui-native` `ThemeProvider`/`useTheme` (follows OS light/dark, can be forced) and `@repo/ui-web` `ThemeProvider` (sets `data-theme`/`data-mode` on `<html>`, falls back to OS preference).
- **i18n**: English, Telugu and Hindi with `{{brand}}` filled from `@repo/brand`; key-parity test; rupee formatting with Indian grouping (`₹1,23,456`).
- **API**: Hono + `@hono/zod-openapi` at `apps/api/src/index.ts` (Vercel zero-config entry), `vercel.json` pinned to `bom1`, `GET /v1/health`, OpenAPI 3.1 at `/openapi.json`, JSON errors with request ids that never echo internals. Local dev server on port 3001.
- **Typed client**: `pnpm openapi` writes the spec and generates `@repo/api-client` types (openapi-typescript + openapi-fetch, with an auth-token middleware).
- **Database**: first Supabase migration enables PostGIS and pgcrypto and creates an append-only `audit_events` table (update, delete and truncate blocked by triggers; RLS on, service role only). Drizzle mirror in `@repo/db`.
- **Web shells**: `web` (landing hero + five service cards) and `console` (sidebar + command-center placeholder), Next 16 App Router, Tailwind v4, fonts via `next/font` owned by `@repo/tokens`, both `vercel.json` pinned to `bom1`.
- **Mobile shells**: `resident` (home: greeting, SOS card, four service tiles, coming-up) and `field` (role, on/off-duty toggle, jobs), Expo SDK 58 / RN 0.88 / Expo Router, development builds (`expo-dev-client`), `eas.json` profiles. App name from brand; permanent IDs from `packages/config/app-ids.json`.
- **Assets**: `pnpm assets` renders icons, adaptive icons, splash screens and favicons from one SVG, coloured from tokens.
- **CI**: `.github/workflows/ci.yml` runs the brand/token checks, a stale-generated-files check, lint, typecheck, tests, both Next builds, Expo dependency checks and `pnpm audit`.

### Verified in this session

- `pnpm check`: brand check ok, token check ok. Both guards were tested with deliberate violations and caught them.
- `turbo run lint typecheck test`: 29/29 tasks pass (83 unit tests, including all contrast pairs in Aurora dark and light).
- `next build` for `web` and `console` succeeds; the compiled CSS contains the semantic utilities and the light/dark/OS-preference variants, and no default Tailwind palette.
- `expo config` resolves the name, scheme, IDs and splash colours; `expo install --check` is clean; `expo-doctor` passes 20/20.
- `expo export` bundles the resident app for Android and iOS and the field app for Android (Hermes).

### Not done yet: blocked on this machine

- **Running the resident app on an Android emulator**: this Windows machine has no Android SDK or JDK. Install Android Studio (SDK, an emulator image, JDK 17), then `cd apps/resident && pnpm android`.
- **iOS simulator**: needs macOS with Xcode. From Windows the alternative is `eas build --profile development --platform ios` on a registered iPhone, which needs the Apple Developer account.
- **Applying the migration locally**: Docker Desktop is installed but was not running. Start it, then `pnpm supabase start`.

### Decisions made (cheap to change, flagged for review)

- **TypeScript 6.0.3, not 7.0**: typescript-eslint 8.72 supports `<6.1`. Revisit when it supports TS 7.
- **React 19.3.0 everywhere** (pnpm catalog), because Expo SDK 58 pins it; avoids duplicate React in the monorepo.
- **pnpm isolated installs** (Expo SDK 54+ supports them). Fallback documented in `pnpm-workspace.yaml`: `nodeLinker: hoisted`.
- **SQL migrations are the source of truth** for DDL, RLS and PostGIS; Drizzle mirrors tables for typed queries. Drizzle Kit has no Supabase-compatible migration naming, and RLS policies are SQL anyway.
- **Supply-chain age gate respected**: pinned i18next 26.5.10 and react-i18next 17.1.8 (2 days old) instead of the releases from the day before, rather than bypassing pnpm's release-age check.
- **Generated assets and the OpenAPI client are committed**, so EAS cloud builds and Vercel builds don't depend on a generation step; CI fails if they are stale.
- **`app.config.ts` reads JSON only** (brand, app IDs, a generated `theme.json`), because Expo evaluates it outside Metro.
- **Deep-link scheme = the reverse-DNS app ID** (neutral and unique). Universal/app links use `brand.domains.links` with `/r` (resident) and `/f` (field) prefixes.

### Open questions for you

1. **Company domain** for the permanent IDs. They are currently the placeholders `in.example.resident` / `in.example.field` and must be set before the first EAS upload.
2. **Aurora light mode** is not in the design file. I derived it (passes AA); it needs design sign-off.
3. **Telugu and Hindi strings** were machine-authored and need a native-speaker review.
4. **Logo**: `packages/brand/assets/logo.svg` is a placeholder mark (house + cross).

### Next

Rest of Phase 1, in order:
1. Install the Android toolchain and run the resident dev build on an emulator (then iOS via a Mac or EAS).
2. Create the Supabase project in `ap-south-1` and the three Vercel projects (`web`, `console`, `api`) in `bom1`, connected to the repo with preview deployments.
3. Phone OTP auth: Supabase phone auth + the Send SMS hook (WhatsApp authentication template first, MSG91 fallback), resident sign-in screen, rate limits; staff email + TOTP for the console. Plan goes in `docs/plans/auth.md` first.
4. Sentry on all apps; Playwright and Maestro skeletons.
5. Outside the code (you): Apple Developer Program, Google Play Console, Critical Alerts request, DLT registration, LiveKit / MSG91 / Razorpay / Google Maps accounts, WhatsApp Business Platform (Meta verification, dedicated number, first templates).
