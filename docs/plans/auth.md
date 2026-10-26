# Plan: auth (Phase 1)

Residents and field staff sign in with phone OTP; console staff with email + TOTP. Roles travel in the JWT. Status: **building**. Items marked **⚑ needs approval** touch consent or the stack.

## Flows

### Resident / field: phone OTP

1. **Phone screen**: +91 number, then a choice of channel. **WhatsApp** is pre-selected, with a plain-language notice ("We'll send your code and service updates on WhatsApp. Reply STOP any time."); **SMS** is the alternative.
2. App → `POST /v1/auth/otp-intent { phone, channel, language }`. Rate-limited per IP; stores `{channel, language}` in Redis for 10 min. Nothing is recorded as consent yet, because the phone isn't verified and anyone could type someone else's number.
   After a successful sign-in with WhatsApp chosen, the app calls `POST /v1/auth/whatsapp-optin { consentVersion }` (authenticated). The phone is taken from the verified token, and a `messaging_optins` row (phone, consent text version, timestamp, source `signin`) is recorded. **⚑ needs approval: treating the WhatsApp choice on the sign-in screen, confirmed by a verified OTP, as the recorded WhatsApp opt-in.** The OTP message itself is an authentication template the user explicitly requested.
3. App → `supabase.auth.signInWithOtp({ phone })`.
4. Supabase Auth → **Send SMS hook** `POST /v1/auth/hooks/send-sms` (Standard Webhooks signature, 5 s budget):
   - per-phone limits: 1 per 30 s, 5 per hour → `429` + `retry-after`
   - reads the channel from step 2 (default SMS if absent)
   - WhatsApp: sends the authentication template (copy-code button). If the Cloud API call fails synchronously, it falls through to SMS in the same request.
   - SMS: MSG91 Flow with the DLT OTP template.
   - writes `message_log` (channel, template, provider id, status). **Never the code.**
5. **Fallback**:
   - For WhatsApp sends, the hook keeps the code **AES-256-GCM encrypted in Redis for 10 min** (the OTP lifetime), keyed by the WhatsApp message id; the key is `OTP_FALLBACK_KEY` and is never logged. When the status webhook reports `failed`, the API decrypts it and sends the SMS at once, then deletes the key. Delivered/read also deletes it.
   - After 30 s the OTP screen shows **"Get code by SMS instead"**, which re-runs steps 2–3 with `channel=sms` (covers "accepted but never delivered").
   - **⚑ needs approval:** the brief says to auto-send SMS if WhatsApp isn't delivered within 60 s. For OTP this plan gives an immediate SMS on a reported failure plus the user-driven switch at 30 s; there is no silent 60 s timer. That timer needs Vercel Workflows, which on Hono requires Nitro, whose only release is a 3.0 beta. I'll bring that choice to you in the Phase 3 (SOS) plan, where a durable timer is mandatory.
6. **OTP screen** → `verifyOtp({ phone, token, type: 'sms' })` → session stored with `LargeSecureStore` (AES-encrypted in AsyncStorage, key in SecureStore), as in Supabase's Expo guide.

### Console staff: email + TOTP

- Email + password (`signInWithPassword`). No self sign-up; accounts are created by `pnpm --filter api staff:create` (service role) or, later, by a super admin.
- Without a verified TOTP factor → `/mfa/enroll` (QR code) → `/mfa/verify`. Every console page requires `aal2` and a staff role; `proxy.ts` (Next 16) refreshes the session with `getClaims()`.
- The API rejects staff routes unless the token has `aal = aal2`.

## Roles in the JWT

- `user_roles(user_id, role, scope_type, scope_id)`. Scope is an optional community/partner id, used later for the community desk and partners.
- Enum `app_role`: `super_admin, operations, community_desk, support, doctor, pharmacy, lab, hospital, crew, phlebotomist, companion, rider`. Residents have no row.
- A Postgres **custom access token hook** adds `app_roles: string[]` to the access token; RLS and the API read it from there.

## Endpoints (API)

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/v1/auth/otp-intent` | public, rate-limited |
| POST | `/v1/auth/whatsapp-optin` | bearer JWT |
| POST | `/v1/auth/hooks/send-sms` | Standard Webhooks signature (Supabase) |
| GET/POST | `/webhooks/whatsapp` | verify token / `X-Hub-Signature-256` |
| GET | `/v1/me` | bearer JWT (JWKS-verified with `jose`) |

## Tables (migration `…_auth.sql`)

`user_roles`, `otp_challenges` (phone hash, channel, requested_at; no code), `message_log`, `messaging_optins`, plus the access-token hook function and RLS (users read their own roles; service role writes).

## Messaging module

- `messaging/whatsapp.ts`: Cloud API client (Graph v26.0); template send; status and STOP handling.
- `messaging/sms.ts`: MSG91 Flow client. **Field names differ between MSG91's old and new docs; verify against the MSG91 dashboard API page before enabling.**
- `messaging/templates.ts`: versioned catalogue (name, category, language, variables) for en/te/hi. OTP = `authentication`.
- Providers sit behind interfaces; tests use fakes, and local dev can use a console "log" provider.

## Tests

- Unit: Standard Webhooks verification (valid / tampered / stale); WhatsApp signature; hook routing (WhatsApp ok, WhatsApp sync fail → SMS, rate-limited → 429, no intent → SMS); STOP opt-out; JWT middleware (valid, expired, wrong issuer, missing aal2 for staff).
- Integration (needs the local Supabase stack / Docker): sign in with a `test_otp` number end-to-end; access-token hook adds roles.
- Maestro: phone → OTP → home (test number). Playwright: console sign-in → TOTP → command center.
