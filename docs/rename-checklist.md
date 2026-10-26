# Rename checklist

The product name is a working name. A rename is `pnpm rebrand --name "…" --domain … [--logo new.svg]` plus the outside approvals below. Do these at the start of Phase 6, before any store submission.

## In the repo (done by `pnpm rebrand`)

- [ ] `packages/brand/brand.json` updated; old name moved to `formerNames` (CI keeps blocking it), old domain to `previousDomains`
- [ ] Logo swapped (`packages/brand/assets/logo.svg`) and icons, splash screens and favicons regenerated (`pnpm assets`)
- [ ] `pnpm check` passes

## Needs outside approval or console changes

| Item | Where | Notes |
| --- | --- | --- |
| WhatsApp display name | Meta Business Manager | Display-name change goes through Meta review. |
| WhatsApp templates that mention the name | Meta template manager | Prefer templates that use no name; re-submit any that do. |
| SMS sender header and DLT templates | DLT portal (operator) + MSG91 | Header and every template containing the name need re-registration. |
| App Store listing and screenshots | App Store Connect | Name, subtitle, screenshots, privacy URL. Bundle ID does **not** change. |
| Play Store listing and screenshots | Play Console | Title, short/long description, feature graphic. Application ID does **not** change. |
| Razorpay merchant name | Razorpay dashboard | Shown on UPI and card statements; may need KYC update. |
| Email sending domain | Email provider DNS (SPF, DKIM, DMARC) | Verify the new domain before switching. |
| API keys restricted by domain | Google Maps, LiveKit, Sentry, Supabase auth redirect URLs | Add new domain before removing the old. |
| Universal links / app links | `apple-app-site-association`, `assetlinks.json` on the new domain | Keep the old domain serving them and redirecting. |
| Vercel domains | Vercel project settings (web, console, api) | Add new domains; keep old ones as permanent redirects. |
| Legal documents | Privacy notice, terms, consent text | Lawyer review if the legal entity changes. |

## Never changes on a rename

- Android `applicationId` / iOS `bundleIdentifier` (`packages/config/app-ids.json`)
- Deep-link scheme, package names, table/bucket/env var names, Vercel and Supabase project names (all neutral by design)
