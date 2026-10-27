# Plan: Phase 2 (households, health record and consent)

Status: **draft for your approval.** The brief says to ask before anything that touches consent or stores new kinds of health data, so nothing here is built until you answer the ⚑ questions. Items marked **⚖ lawyer** need legal review; the plan builds them so the answer can change by configuration, not code.

Scope from the brief: organisations, sites, homes, households, family accounts, consent, the full Health tab and home snapshot, and the residents directory in the console.

---

## 1. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| ⚑1 | **Default state of optional consents.** The design shows "share with hospital" and "alert family" switched **on**. DPDP consent must be a clear affirmative action, so pre-ticked boxes are risky. | Nothing pre-ticked. The onboarding consent screen asks for each purpose with a plain-language explanation and a recommended choice. Emergency sharing is presented first, with what changes if it's off (the hospital gets the blood group only). ⚖ |
| ⚑2 | **Staff editing consent.** The console design lets staff tick a resident's consent boxes and edit their medical details. | Staff **cannot** change consent; the console shows it read-only. Medical edits in the console are limited to the care team, always audited, and the resident is notified. The community desk can never edit or see medical data. |
| ⚑3 | **Family managers** (an adult child managing a parent's care). | The parent grants it explicitly in their own app ("Let Arjun manage my care"), recorded as a consent with scope and expiry, and revocable at any time. Managers act *on behalf of* the parent; every action is audited with both identities. ⚖ (DPDP treats consent for an adult differently from a guardian for a child or a person with a disability.) |
| ~~⚑4~~ | ~~Residents without a smartphone~~ | **Decided 2026-10-27: not needed.** The target audience uses smartphones, so everyone signs up and consents in their own app. No assisted-consent flow. |
| ⚑5 | **Proactive care** (resident heatmap risk tiers, "needs a check-in" list, vitals alerts to the care team). This is health data used for outreach, a separate purpose. | Its own opt-in purpose ("Let the care team watch my readings and contact me"). People who say no don't appear in risk tiers or alerts. Heatmap counts are aggregated and never per-home for non-consenting households. ⚖ |
| ⚑6 | **Community desk visibility.** | Name, home number, phone (masked except when calling through the console), whether they're on the app, and live SOS status. Never conditions, readings, medicines or reports. |
| ⚑7 | **Data retention and erasure.** Medical records may have legal retention periods that override erasure requests. | Erasure requests come from the Profile screen. Non-medical data is deleted within 30 days; medical records are restricted (hidden, unusable) and deleted when the retention period ends. A retention table per data type, values to be set by a lawyer. ⚖ |
| ⚑8 | **Health Connect / HealthKit import** (brief: "manual and Health Connect / HealthKit import first"). | Phase 2 imports only the six vitals in the Health tab (BP, pulse, SpO2, sugar, temperature, weight). Anything else from the phone (steps, sleep, cycle data and so on) needs your separate approval. |

---

## 2. Consent model

**Purposes** (a versioned catalogue in code; each has notice text in en/te/hi, a version, and whether it's required):

| Purpose key | What it allows | Required? |
|---|---|---|
| `care_record` | Store the health record so the app can provide services | Required to use health features (service-necessary); can't be "off" while the account holds health data. Withdrawing means closing the record (see erasure). |
| `emergency_share` | Send the handover record (blood group, allergies, conditions, medicines, last vitals, emergency contacts, insurance) to the receiving network hospital during an SOS | Optional. Off → blood group only (brief). |
| `family_sos_alert` | Tell listed family contacts that an SOS happened (no medical details) | Optional |
| `doctor_share` | Per-booking choice of what the doctor sees: vitals, conditions & allergies, medicines, lab reports (the design's four items) | Asked at each booking; never standing |
| `proactive_care` | Care team monitors readings, risk tiers, vitals alerts, check-in outreach | Optional (⚑5) |
| `manager:<user>` | A named family member may act on the person's behalf | Optional (⚑3) |
| `whatsapp_updates` | Service messages on WhatsApp (built in Phase 1) | Optional |
| `reminders` | Medicine reminders (design toggle) | Optional, a preference rather than a data-sharing consent |

**Tables**:
- `consents` is append-only: user, purpose, scope (JSON, e.g. which items or which manager), status granted/withdrawn, notice version, language, timestamp. The current state is the latest row per (user, purpose, scope).
- `record_shares` records who saw what, when and why (purpose + booking/incident id), written on every disclosure.

**Enforcement**: one `consent` service in the API answers `can(subject, purpose, scope)`. Every module that discloses health data calls it, and every disclosure writes `record_shares` and `audit_events`. RLS is the backstop: health tables are readable only by the person, their active managers, and staff/partners through API endpoints that check consent. There are no direct table grants for staff.

**Withdrawal** takes effect immediately: open emergency handover links are revoked, doctor access to a booking's shared items ends when the consult ends, and managers lose access at once.

---

## 3. Data model (migration `…_households.sql` + `…_health_record.sql` + `…_consent.sql`)

- **Customers**:
  - `organisations` (type: community / senior_home / employer)
  - `sites` (PostGIS boundary polygon)
  - `homes` (villa or flat: tower, floor, number, point location)
  - `households`, where `home_id` is **nullable** so a family without a community works
  - `household_members` (role: owner / member; relation)
  - `emergency_contacts` (name, relation, phone; may or may not be app users)
- **Health record**: `health_profiles` (blood group, height, date of birth), `vital_readings` (type, value(s), unit, source manual/device/import, taken_at, entered_by), `conditions` (status controlled/monitoring/active), `allergies` (severity), `medications`, `medication_doses` (adherence), `vaccinations`, `insurance_policies`, `devices`. All have a soft delete and `entered_by` (self / manager / care team). Values are validated against physiological ranges, as in the design's log sheet.
- **Consent**: `consents`, `record_shares` (above).
- **Encryption**: free-text clinical notes and insurance numbers get field-level encryption (brief). Readings stay queryable.
- **ABDM-ready**: stable UUIDs, LOINC/SNOMED codes stored alongside display names where available, so FHIR export can be added later.

---

## 4. API (module per domain)

- `households`: create/join a household (community code, address, or standalone), invite members, add/remove emergency contacts, grant/revoke manager.
- `health-records`: CRUD for each record type; `GET /v1/health/summary` (home snapshot: latest BP, pulse, SpO2, sugar with status); `GET /v1/health/vitals/{type}?last=7` (trend + target band); validation shared with the app via `@repo/contracts`.
- `consent`: `GET /v1/consents` (current state + notice text), `POST /v1/consents` (grant/withdraw, with notice version), `GET /v1/consents/history`, `POST /v1/privacy/requests` (access/erasure).
- `console` (staff): `GET /v1/residents` (directory, filtered by the staff member's scope; desk sees the ⚑6 fields only), `GET /v1/residents/{id}` (care team: medical detail only where consent allows; every read is audited).

Everything acting on someone else's data takes an explicit `subjectId` and checks manager consent.

---

## 5. Screens

- **Resident app**:
  - onboarding: language → household (join by code/address or stand alone) → family members → **consent screen** (§2)
  - Home snapshot and dose check-off
  - Health tab with six vitals, 7-reading trends with target bands, log sheet, BMI, conditions, allergies, medicines and 30-day adherence, vaccinations, insurance e-card, devices (manual + import)
  - Profile → **Privacy** (current consents, history, manage family managers, download my data, delete my account)
- **Family manager view**: a person switcher at the top ("Viewing: Amma"); actions are labelled as on behalf of.
- **Console**: residents directory (search, filter by site/tower, on-app status), resident profile (read-only consent panel, medical sections only with consent, audited reads).

---

## 6. Tests

- Consent service: every purpose × granted/withdrawn/never × subject/manager/staff role, including the emergency-share-off → blood-group-only rule and immediate withdrawal.
- RLS tests against the local Supabase stack: a household member can't read another household; the desk can't read any health table; a revoked manager loses access.
- API: every disclosure writes `record_shares` and `audit_events`; staff reads are audited; the directory respects scope.
- Maestro: onboarding with each consent choice, logging a reading, granting and revoking a manager. Playwright: directory and resident profile as desk vs care team.

---

## 7. Order of work once approved

1. Migrations + RLS + consent service (with tests)
2. Households & family (API + resident onboarding)
3. Health record API + Health tab + home snapshot
4. Privacy screen (consents, history, access/erasure requests)
5. Console residents directory + profile

Web-first, as agreed: the console parts can start right after step 1, and the resident screens follow on Android.
