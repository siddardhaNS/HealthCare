# Progress

## 2026-10-27 · Phase 3, step 1: SOS state machine, tables and raise/cancel API

Plan approved today (all recommendations): `docs/plans/phase-3-sos.md`.

### Done
- **State machine** in `@repo/contracts/sos` (browser-safe):
  - every legal transition and who may make it (resident, crew, desk, system); reasons required for desk cancels, reassignments and close-after-treatment-on-scene
  - a resident can cancel until the ambulance is on its way; after that only the desk
  - a crew can still accept after the 108 prompt
  - 18 tests
- **Migration `…_sos.sql`**:
  - ambulances (company work number), crews (drill participants), crew shifts, standby points, hospitals (capacity), per-site thresholds (15–60 s / 60–180 s, defaults 30 / 90)
  - incidents: **one open SOS per person** enforced by the database, idempotency key per sender
  - append-only `sos_events` timeline, dispatch offers, hospital handovers (token hash, consented items)
  - RLS: people and their managers read their own incidents and timeline
- **API**:
  - `POST /v1/sos`: idempotent; retries and second presses return the open incident; works without GPS; uses the community’s thresholds; rate-limited only against abuse
  - `GET /v1/sos/current`, `GET /v1/sos/{id}` (with timeline), `POST /v1/sos/{id}/cancel`
  - every state change is compare-and-set and writes `sos_events` **and** `audit_events` in one transaction
- 130 API tests (10 new).

### Next
2. Workflows: serve the Hono API from a thin Next.js app (plan ⚑ 1), then the escalation workflow with simulated crews.
3. Dispatch (Redis GEO, ETAs, offers, first-accept-wins), then the field app, resident SOS screens, console command center.

### Console test login
No staff accounts exist until the local database runs (needs WSL → Docker). Then: `pnpm --filter api staff:create --email … --role super_admin`, and TOTP set-up on first sign-in.

## 2026-10-27 · Phase 2, step 4: resident app screens (Android/iOS)

### Done
- **Onboarding** after sign-in, resuming at the first unfinished step:
  1. name + app language (applied app-wide)
  2. household: join by community code + villa/flat, set up an own home, or accept a family invitation
  3. consent screen: nothing pre-ticked; the core record is required; emergency sharing first and marked recommended
- **Tabs** as in the design: Home, Health, Bookings, Records, Profile (Bookings/Records are placeholders until Phases 4–5).
- **Home**: greeting by name, live snapshot (BP, pulse, SpO2, sugar with status colours), SOS card (until Phase 3 it explains SOS is coming and offers a one-tap call to 108), service tiles, today's medicines with "Mark taken".
- **Health**:
  - six vital tiles; tap one for its last-7 trend chart with the target band shaded
  - "Log a reading" sheet with validation messages from the API
  - conditions and allergies (add/remove)
  - medicines with 30-day adherence bars
  - devices, vaccinations (due-soon flag), insurance cards with show/hide numbers
- **Profile**:
  - name, age, home; blood group / conditions / allergies
  - emergency contacts (call, add, remove)
  - family members with the "can manage my care" switch, showing the manager notice
  - invite by phone, cancel invites
  - **Privacy** switches for every optional consent (outdated ones shown as off until agreed again)
  - consent history; sign out
- Shared `@repo/icons` (design icon paths) used by both web and native icon components; native `Icon` via react-native-svg.
- Data via @tanstack/react-query (5.104.5); every change refreshes what it affects.
- All screen text in en/te/hi.

### Verified
- Typecheck and lint clean; Metro bundles for Android and iOS; `expo install --check` clean; all repo checks pass (36 tasks).
- Bundle check: no server code in the app. Size grew mostly from Sentry (core/browser/replay ~2 MB of source); trim later if needed.

### Not verified yet
- Not run on a device or emulator: needs Android Studio (or EAS dev build) **and** the local Supabase stack (Docker → WSL 2).

### Next
1. When WSL/Docker is up: first real database run, then Chrome walkthrough of the console flows.
2. When Android Studio is installed: run the resident app on an emulator end to end (sign-in → onboarding → Health → Profile).
3. Phase 3 plan (SOS) for your approval: the riskiest phase, and it needs the Vercel Workflows / Nitro decision.

## 2026-10-27 · Phase 2, step 3: health record API and console medical view

### Done
- **Shared vital rules** (`@repo/contracts/vitals`, browser-safe): units, accepted ranges, target bands, the design's status rules (e.g. BP ≥ 140/90 = High), BMI. 21 tests.
- **Health API** (`/v1/people/{userId}/health/…`, for the person or their manager; runs as the user so RLS applies):
  - summary (profile, latest of each vital, conditions, allergies, medicines), profile, vital series with target band, log/remove reading
  - conditions (notes **encrypted at rest** with `FIELD_ENC_KEY`), allergies, medicines with dose times
  - dose check-off (today and the past week, scheduled times only) and **30-day adherence** (taken ÷ due, IST)
  - readings are validated (impossible values, BP without diastolic, future times are refused)
  - entries made by a manager or the care team are marked
- **Care team view** `GET /v1/residents/{userId}/health`: super admin / operations / support only, **only with the person's `proactive_care` consent**; every view is written to `record_shares` and `audit_events`.
- **Console resident profile** now shows the medical section when allowed: six vitals with status colours, blood group / age / BMI, conditions, allergies with severity, medicines with adherence. Strings in en/te/hi (shared `health.*`, reusable by the app).
- 113 API tests (16 new), mutation-checked on the consent gate and the access guard.

### Testing in Chrome (new standing practice)
From now on each feature is also clicked through in Chrome. The console flows (residents, health view, leads) need staff sign-in, so they need the local Supabase stack, i.e. **Docker Desktop running**.

### Next
1. Chrome walkthrough of console flows once Docker is up (and fixes from the first real database run).
2. ~~Vaccinations, insurance, devices~~ done: vaccinations with due-in-30-days flag; insurance with policy/member numbers encrypted at rest, returned only to the person and their manager (not in the care team view); devices for manual entry and Health Connect / HealthKit (Bluetooth refused until it is built). E-card image upload waits for file storage (Supabase Storage). 120 API tests.
   **Blocked for Chrome testing:** Docker Desktop needs WSL 2, which is not installed. The user installs it as admin (wsl --install --no-distribution) and restarts.
3. Resident app screens on Android.

## 2026-10-27 · Phase 2, step 2: households & family API, console residents directory

### Done
- **Migration `…_profiles_invites.sql`**: `profiles` (name, language; visible to yourself and your household), `household_invites`, and a `shares_household` helper.
- **Households API**:
  - `GET /v1/households/me`; `POST /v1/households` (standalone for families, or join by community code + villa/flat).
  - Invitations: `POST /v1/households/invites`, `DELETE …/{id}`, `GET /v1/me/invites`, `POST /v1/me/invites/{id}/accept`.
  - Profile: `GET|PUT /v1/me/profile`.
  - Emergency contacts: `/v1/people/{userId}/emergency-contacts`, for yourself or someone who made you their manager.
  - Rules:
    - One household per person.
    - **A code + flat number can only start a household for an empty home; joining an existing household always needs an invite from a member.**
    - Invites last 7 days and can only be accepted by the invited (verified) phone number.
    - **A manager must be in your household** (enforced when the consent is recorded); withdrawing it removes access at once.
- **Residents directory** (web console, `/residents` and `/residents/[id]`, API `/v1/residents`):
  - The community desk sees only its own community (scope from `user_roles`) and never consent detail or medical data.
  - The care team (super admin, operations, support) sees everyone and each person's consent state (read-only).
  - Medical access shows as granted only with the person's `proactive_care` consent; the medical sections arrive with the health record step.
  - **Phone numbers are masked for all staff** (brief: never show residents' personal numbers to staff).
  - Every profile view is written to `audit_events`.
  - Strings in en/te/hi.
- 97 API tests (23 new: households, invitations, managers, contacts, directory scope), mutation-checked on the household-join guard.

### Not verified yet
- As before, new SQL is parsed by the Postgres 17 parser but not executed (no Docker); the residents query joins `auth.users` for phone numbers and needs a real database to confirm.

### Next
1. Health record API + console resident profile medical sections (care team, with consent) — web first.
2. Resident app screens (Android): onboarding (profile, household, family invites, consent screen), Health tab, home snapshot, Privacy.

## 2026-10-27 · Phase 2, step 1: consent, households and health-record foundations

Plan approved today: `docs/plans/phase-2-households-consent.md` (all recommendations; assisted onboarding dropped).

### Done
- **Migrations** (`…_consent.sql`, `…_households.sql`, `…_health_record.sql`):
  - Append-only `consents` and `record_shares`, with no foreign key to users so consent evidence survives account deletion.
  - `has_consent` / `can_act_for` helpers (self or a granted manager).
  - Organisations, sites (PostGIS boundary, join code), homes, households (`home_id` nullable for families), members, emergency contacts.
  - The nine health-record tables, with physiological range checks on readings, soft delete, `entered_by`, and encrypted-at-API columns for free text and insurance numbers.
  - **Every insert/update on a health table writes `audit_events` by trigger** (ids only, never values).
  - RLS: health data readable/writable only by the person and their managers; households readable by members, writes via the API; no client delete.
- **Consent catalogue** in `@repo/contracts/consent` (browser-safe): purposes, required/standing/onboarding flags, notice versions, emergency handover rule (consent off → blood group only), doctor-share items.
- **Consent notices** in en/te/hi (`consent.*` in the i18n files), with a test that every purpose has text in every language.
- **API `consent` module**:
  - `GET /v1/consents` (every standing purpose incl. "not asked", plus scoped ones), `POST /v1/consents` (grant/withdraw, immediate), `GET /v1/consents/history`.
  - Refuses stale notice versions, withdrawing the core record (→ erasure request), and bad scopes.
  - A consent counts only against the notice version in force.
- **`asUser`** in `@repo/db`: the API runs user queries with the `authenticated` role and verified claims, so Postgres RLS applies to the API too (consent writes use it).
- 74 API tests (15 new), 6 i18n tests.

### Not verified yet
- The new SQL is checked with the real Postgres 17 parser (libpg_query) but **not executed**: Docker isn't running. The PL/pgSQL bodies were reviewed by hand. First run of `pnpm supabase start` will apply all migrations; expect possible small fixes.

### Next
1. Households & family API + resident onboarding (household, family members, consent screen), with the manager flow.
2. Health record API + Health tab + home snapshot.
3. Privacy screen (consents, history, access/erasure requests).
4. Console residents directory + resident profile (read-only consent, audited reads).

## 2026-10-26 · Web first, session 3: leads backend, landing groundwork (in progress)

### Done
- **Leads API**: `POST /v1/leads` (public; CORS limited to the landing origins, 5/hour per IP, honeypot that fakes success, consent required), `GET /v1/leads` and `PATCH /v1/leads/{id}` for super admin / operations at aal2. The sales alert email carries only a reference, type, city, size and a console link, never contact details. Neutral references like `L-7K3Q9P`. 16 new tests (59 API tests in total).
- **Migration** `…_leads.sql` (statuses as in the brief: new, contacted, walkthrough booked, live) + Drizzle mirror.
- **Landing copy** in `packages/i18n/locales/landing.en.json` (`landing` namespace), broadened for senior-living homes, employers and families. English-first; te/hi fall back to English.
- **Logo** switched to the design's pulse mark; icons, splash and favicons regenerated.
- Shared `Icon` component in `@repo/ui-web` with the design's icon paths.

### Next (pick up here)
1. ~~Landing page~~ done: every section from the design (nav, hero with phone mock, audiences, services tabs with keyboard support, SOS walkthrough, why us, how it works for villas / apartments / families, console preview, plans, two-step sign-up posting to `/v1/leads`, FAQ, CTA, footer), robots + sitemap. 10 Playwright tests incl. the full sign-up flow and axe WCAG AA. Light/dark follows the visitor's OS setting.
2. ~~Console `/leads` page~~ done (list, status filter, status change, sidebar link for super admin / operations). Needs a live check once Supabase runs.
3. Next: Phase 2 web work (residents directory in the console) needs the consent design first; see open questions.

### Needs your input
- **Email provider: Resend** (decided 2026-10-26). To be configured later: add a Resend transport in `apps/api/src/modules/notifications/mailer.ts`, a `RESEND_API_KEY` env var, and verify the sending domain from `packages/brand`. Until then only the log transport exists.
- **Plan prices**: removed from the landing page for now (decided 2026-10-26); plan cards show no price.
- Landing te/hi translations.


## 2026-10-26 · Phase 1 (Foundations), session 2: auth, messaging, Sentry, e2e

Plan: `docs/plans/auth.md`. Built against provider docs checked today (Supabase auth hooks, MFA, SSR and Expo guides; WhatsApp Cloud API copy-code templates; Sentry Next.js/Expo/Hono; Workflow SDK; MSG91).

### Done

- **Database** (`…_auth.sql`): `app_role` enum, `user_roles` (optional site/organisation/partner scope), a Postgres **custom access token hook** that adds `app_roles` to every JWT, `otp_challenges` (hashed phone, never the code), `message_log` (no message bodies or variables), and append-only `messaging_optins`. Drizzle mirrors added.
- **Supabase config**: phone sign-up on; test OTP numbers +91 99999 00001 / 00002 (code `123456`); 30 s resend interval; Send SMS hook → API; TOTP MFA on; staff email self-sign-up off.
- **API**:
  - `POST /v1/auth/otp-intent` remembers the chosen channel (WhatsApp or SMS) and language; rate-limited per IP.
  - `POST /v1/auth/hooks/send-sms` is the Supabase hook:
    - verifies the Standard Webhooks signature
    - limits each phone to 1 code per 30 s and 5 per hour
    - sends a WhatsApp copy-code template and falls through to MSG91 SMS in the same request if WhatsApp fails
    - holds WhatsApp codes AES-256-GCM-encrypted in Redis for 10 min, so a `failed` delivery receipt triggers an immediate SMS
  - `POST /v1/auth/whatsapp-optin` records consent only after sign-in, with the phone taken from the verified token.
  - `GET /v1/me`.
  - `GET|POST /webhooks/whatsapp`: handshake, `X-Hub-Signature-256` check, status updates that never move backwards, STOP opt-out.
  - JWT verification via JWKS (`jose`); `requireStaff` = console role + `aal2`.
  - Config is validated at start-up; production refuses to run without Upstash (no in-memory state) or with the local HS256 secret.
  - `MESSAGING_MODE=log` for local dev never logs codes.
  - `pnpm --filter api staff:create` creates console accounts.
- **Mobile sign-in** (`@repo/mobile`, used by both apps):
  - Supabase client with encrypted session storage (Supabase's `LargeSecureStore` pattern).
  - Phone screen with a WhatsApp/SMS choice and the consent notice; OTP screen with resend and "Get the code by SMS instead" after 30 s.
  - Routes are protected with `Stack.Protected`.
  - The field app admits only field roles (checked via `/v1/me`).
  - Strings in en/te/hi.
- **Console**:
  - Staff sign-in (email + password).
  - TOTP enrolment (QR code) and verification.
  - `proxy.ts` (Next 16) refreshes the session and routes users without a session or role, or at aal1; the `(console)` layout checks again on the server.
  - Sign-out.
- **Sentry** on the API, web, console and both mobile apps. It's a no-op without a DSN. Every data-collection category is off, a `beforeSend` scrubber strips user/request/extra data (unit-tested), and there's no session replay or screenshots.
- **Tests**:
  - API: 43 unit tests, mutation-checked on two key behaviours.
  - Playwright: 14 tests (desktop + 360 px phone), including axe WCAG AA scans of the landing page and console sign-in. Added to CI.
  - Maestro: sign-in flows written for both apps (not yet run; no emulator).
- **Tokens**: new `qrBackground` role (QR codes need a light background in every theme).

### Verified

- `pnpm check`, lint, typecheck and unit tests pass across the repo. Both Next apps build; both Expo apps bundle for Android and iOS. No server code (Hono/OpenAPI) is in the phone bundles.
- Real HTTP smoke test of the API (valid/invalid intent, unsigned hook → JSON 401, `/v1/me` without a token → 401, WhatsApp handshake).
- Local dev servers: API :3001, console :3002, landing **:3003**. Port 3000 is taken by another local project, so run `npx next dev --port 3003` in `apps/web`.

### Not verified yet (needs Docker / accounts)

- Migrations, the access-token hook and RLS against a real database. Docker Desktop wasn't running.
- End-to-end OTP through Supabase → hook → WhatsApp/MSG91, and console sign-in → TOTP. The code paths are unit-tested with fakes.
- MSG91 request field names (their docs disagree; marked in `providers.ts`).
- Vercel deploy of the API (TS workspace imports through zero-config Hono).

### Decisions and questions (⚑ = your call)

1. ⚑ **WhatsApp opt-in = the choice on the sign-in screen, confirmed by a verified OTP.** It's recorded after sign-in with the notice version (`wa-2026-10`). Nothing is recorded before the phone is verified, so nobody can opt in someone else's number.
2. ⚑ **OTP fallback**: an immediate SMS when WhatsApp reports `failed`, plus a user-driven switch to SMS after 30 s, instead of a silent 60 s timer. The durable-timer version needs Vercel Workflows, which on Hono **requires Nitro, currently only a 3.0 beta**. I'll bring that choice to the Phase 3 (SOS) plan.
3. ⚑ **Sentry stores data in the US or EU, not India.** Events are scrubbed of health and personal data, but this needs legal review before production (DPDP / "keep health data in India").
4. Hindi/Telugu STOP keywords (`रोकें`, `ఆపు`) and all te/hi strings need a native-speaker check.
5. The Maestro flows use the placeholder app IDs (`in.example.*`); update them with the company domain.

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
