# Progress

## 2026-10-31 · Phase 3, step 10 (started): SOS notifications

Your decisions are written up as plan §13: family = emergency contacts only, and the resident confirms each contact agreed to alerts.

- **Done:** migration `20261031040000_contact_alerts.sql` (applied locally). It adds `emergency_contacts.alerts_agreed_at` / `alerts_confirmed_by`, and `messaging_optins.source` accepts `confirmed_by_resident`.
- **Sub-step A done** (contact opt-in):
  - `alertsAgreed` on emergency contacts (add, list) and new `PUT /v1/people/{userId}/emergency-contacts/{id}/alerts`.
  - Each confirmation or withdrawal writes WhatsApp and SMS rows to `messaging_optins` (source `confirmed_by_resident`, service connection; the contact row is updated under RLS).
  - 1 new test (API 249). Checked against the real DB.
  - Resident Profile: a toggle per contact (red "Won't get SOS alerts until you confirm they agree" when off), and a tick on the add form. Checked on the emulator.
  - Note for B: residents already have a consent, "Alert my family on every SOS" (`family_sos_alert`). Alerts must also respect it.
- **Then sub-step B:**
  - Templates: `sos_alert_family`, `sos_alert_desk`, `sos_alert_gate`, `sos_update_family`.
  - One notify workflow per real SOS: WhatsApp now, SMS after 60 s if not delivered.
  - The final update on handed-over or cancelled.
  - A gate phone field on the SOS timeout page.

## 2026-10-31 · Phase 3, step 9: crew patient summary, first-aid notes, what the resident sees was shared

Your decision (plan §12): the crew sees the same items as the ER, under the resident's emergency-sharing consent, during the job only, and every view is logged.

- **API** `GET /v1/sos/{id}/patient` (crew on the job only, active states, never drills, `no-store`):
  - Returns blood group, allergies, conditions and current medicines, filtered by consent; with consent off, the blood group only.
  - Contacts, insurance and vitals stay with the hospital.
  - Each view goes into `record_shares` (role `crew`). 3 new tests (API: 248 unit, 7 workflow).
- **Field app:**
  - A patient card on the job panel, loaded once per job (each load is a logged view). Allergies are in red, and there's a note when consent limits it to the blood group.
  - First-aid notes appear once a hospital is chosen (the notes travel with the handover, encrypted at rest).
  - On the emulator: consent off showed the blood group only; consent on showed "Penicillin (severe)" in red. The notes were saved, and the database holds ciphertext only. All views are logged.
- **Resident app:** the SOS screen's hospital card now says where the record was sent, which items (never their contents), and whether the ER has confirmed. It typechecks; it isn't yet seen on a device, because the e2e resident is an email account the resident app can't sign in.

### Next
- Phase 3 notifications (plan §3.3): family and desk alerts (push, WhatsApp, and SMS if WhatsApp isn't delivered in 60 s), gate security, and the family's final update. Log mode until the providers are set up.

## 2026-10-31 · Phase 3, step 8 (part 4): e2e un-skipped, signed-in CI job, Expo dependencies

### The three skipped console tests now run and pass
- **"The test crew gets no offer"** was a test bug.
  - `crewAccepts` asked the desk to offer the job right after the SOS was raised, while it was still `raised` (the escalation workflow moves it to `dispatching` a moment later). The API correctly refuses that.
  - It now waits for dispatch to begin. The tests follow plan §11: the crew picks the hospital (`crewPicks`).
- **`/hospitals` WCAG AA:** the 4 contrast failures came from fading inactive cards with `opacity-70`.
  - Inactive hospital and team cards now use a dashed border, plus the "Inactive" label they already had.
  - The axe failure message now names each failing element.
- **Flakes found and fixed:**
  - Forms that submit through `onSubmit` did a plain browser GET when clicked before React hydrated (seen as a test SOS that never started). This affected desk users on a slow network too.
    - Their buttons and fields now stay disabled until hydrated (`useHydrated`, via `useSyncExternalStore`).
  - Global setup's TOTP check also tries the neighbouring 30 s windows (the local stack's clock drifts under load).
- The signed-in suite passes **9/9, twice in a row**.

### CI
- New job **`e2e-signed-in`**: it starts the local Supabase stack on the runner (without studio, imgproxy, edge-runtime, logflare, vector, supavisor, postgres-meta) and writes `.env` files from `supabase status`. Per-run secrets are generated with `openssl`.
  - It runs the API in dev mode, and Playwright builds and starts the console.
  - It uploads traces and the API log on failure.
  - It is separate from `verify`, so a red step there never skips it.
- **Expo dependency check fixed:** `expo install --fix` in both apps (Expo SDK 58 patch releases, react-native 0.88.0 → 0.88.1).
  - Both native dev builds were rebuilt (`expo prebuild` + `expo run:android`: resident 10 min, field 4.5 min).
  - On the emulator: resident Home and Health, field duty on/off. No native errors.
- **Field app fix found while testing:** going on duty waits for a location fix (seconds). Meanwhile the switch looked off and stayed tappable, so a second tap undid the first (seen in `crew_shifts`).
  - The switch is now locked during the wait and says "Getting your location…".

- **CI is fully green** for the first time (run 41171824517): `verify` and `e2e-signed-in` both pass.
  - The first run of the new job failed: the console needs `packages/tokens/dist`, which only a turbo build produces. The job now builds through turbo and starts the console itself.
  - Once the Expo step passed, the dependency audit ran and failed on node-forge <1.4.1 (5 high, via `@expo/cli`). Fixed with an override to 1.4.2, which is in `@expo/cli`'s range. The old node-forge audit ignore is removed.

### Next
- Clean-up idea: e2e runs leave three deactivated test teams each time (teams cannot be deleted). Consider a delete for unused teams, or reusing named test teams.

## 2026-10-31 · Phase 3, step 8 (plan §11, part 3): no 108 anywhere, desk number, languages, crew picks the hospital

Plan §11 is now built. Your answers today:
- **No automatic hospital:** the crew picks.
- **New:** a console setting for the app languages. English is always on; Telugu and Hindi appear only once enabled.

### Done (one commit each)
1. **SOS timeout** (`26cc0f3`)
   - Each community has one value, "Next crew after (s)", 15–60 s.
   - The 108 threshold is gone from the API, console and new incidents. The column stays for past incidents (migration `20261031010000`).
   - Console page renamed "SOS timeout".
2. **Named alarms** (`26cc0f3`)
   - "ABC team did not respond. Offered to XYZ."
   - "XYZ did not respond. Offered to the nearest free crews."
   - "Still no crew…" when there are no teams.
   - The 108 alarm is removed.
3. **Community desk number** (`aa54220`)
   - A one-row `ops_settings` table; every change is audited.
   - Public `GET /v1/config` (cacheable for 60 s) and super-admin-only `PUT /v1/settings/desk-phone`.
   - Console **Settings** page, plus a warning on the command center until the number is set.
4. **Languages** (`c82725e`, your request)
   - `ops_settings.languages`, always including `en`, audited; returned by `/v1/config`.
   - `PUT /v1/settings/languages` (super admin).
   - Console checkboxes; English is shown checked and locked.
5. **Resident app** (`ca185c1`)
   - Every "Call 108" button and the 108 banner are removed.
   - "Call community desk" uses the console number, kept on the phone (`lib/app-config.ts`). With no number set, a short note shows instead.
   - The onboarding language picker lists only enabled languages, and is hidden when only English is on. A language that gets switched off falls back to English.
   - Old incidents in the 108 state read as "finding an ambulance".
   - The Maestro offline flow waits for the fallback text.
6. **The crew picks the hospital** (`d4f51f4`)
   - Accept opens no handover.
   - `GET /v1/sos/{id}/hospitals` lists every active hospital, nearest to the patient first, with ER full and the person's preferred hospital marked.
   - The crew's first pick opens the handover (record, signed link, partner portal) with no reason; changing it needs a reason.
   - The desk can pick, always with a reason.
   - The console shows "Hospital not chosen yet…"; the no-hospital alarm is removed.
   - Field app: a hospital picker on the job panel.
7. **Load test re-run**, 50 SOS and 60 crews:
   - **50/50 accepted** (before §11: 44–49), with no 5xx.
   - raise → first offer: p50 5.3 s.
   - raise → accepted: p50 7.1 s, p95 66 s (picked up by later rings, 30 s apart).

### Checked
- API: 245 unit + 7 workflow tests pass.
- Signed-in console e2e: 6 pass (3 still `fixme`).
- Typecheck, lint, `pnpm check` and i18n parity pass.
- Clicked through in Chrome:
  - SOS timeout save
  - all three alarm texts, live
  - the desk-number warning, save, and the warning gone after saving
  - the language checkboxes
  - "Hospital not chosen yet", then the desk choosing with a reason
- Checked through the API against the local stack:
  - the crew's change is refused without a reason
- **On the Android emulator** (dev builds, local stack):
  - Resident onboarding:
    - Telugu on, Hindi off: the picker shows English and తెలుగు only.
    - English only: the picker is hidden.
  - A resident whose profile says Telugu, with only English enabled, sees English.
  - Live SOS: no 108 button; **Call desk** opens the dialer with the console number.
  - Field app, after accept:
    - Choose the hospital: a distance-sorted list. Picking one shows "Record sent. Waiting for the ER to confirm".
    - Change hospital: the list stays disabled until a reason is typed, then a new handover opens.
    - The reason is stored on the handover. The audit records the crew, both hospitals and the consented items, but not the free-text reason.
  - Maestro `sign-in.yaml` still fails to reconnect the dev build to Metro after `clearState` (known from 28 Oct). Tested by hand with adb instead.

### Found on the way
- After appending to a server-actions file, `next dev` (Turbopack) can serve a stale module ("action is not a function"). Restarting the dev server fixes it.
- The workflow dev bundle may also need a restart to pick up step changes.
- The e2e test resident had no household, which likely explains the `fixme` "the test crew gets no offer for a resident SOS". A stand-alone household now exists for it in the local DB. Not checked in the e2e yet.
- Running the load test needs `SUPABASE_JWT_SECRET`, `SUPABASE_SECRET_KEY` and `SUPABASE_URL` from `supabase status`, and the API restarted with the same JWT secret.

### Local state left behind
- Desk number `+914023456789` (a test value).
- Languages en + te.
- E2E Gardens timeout 15 s.
- Test teams "Backup Z" and the e2e "Primary/Backup one/two" teams (inactive).

### Next
- Fix the 3 `fixme` e2e tests (the resident's household may be the cause), and the `/hospitals` contrast.
- Add the signed-in e2e suite as its own CI job.
- CI is still red only on "Expo config and dependency check".

## 2026-10-31 · Phase 3, step 8 (plan §11, part 2): backup teams in the console

Already in `ebe7ac0` (30 Oct, not logged then): the workflow offers the primary team, then at every timeout alarms the desk and offers the next backup team, then the nearest free crews (up to 20 rings). The 108 step is gone from the state machine.

### This session
- **API:**
  - `GET /v1/coverage/places` now returns each place's ordered `backups`.
  - `PUT /v1/coverage/assignments` takes `as: primary | backup`. "Backup" adds the team to the end of each selected place's list, and skips places the team already covers.
  - New `PUT /v1/coverage/backups` replaces one place's list (reorder, remove, add) in a single call. It is audited as `coverage_backups_set` with the before and after lists.
  - Rules:
    - a place needs a primary team before it can have backups
    - at most 9 backups per place
    - no duplicates, and the primary can't also be a backup
    - an inactive team can stay on a list (dispatch skips it) but can't be added
    - a backup made primary leaves the list
    - removing a place's cover removes its backups too
    - ranks are always rewritten as 1..n, so there are no gaps
- **Console:**
  - The places page shows "Primary: X" and "Backups: 1. Y, 2. Z" on each row, with **Set as primary** and **Add as backup** buttons.
  - New page `/coverage/places/{kind}/{id}` to move teams up or down, remove them, and add backups.
  - Strings added in en / te / hi.
- **Bug found in Chrome and fixed:** making a backup team the primary failed with a 500 (unique index: the team was inserted as primary while it was still on the backup list). The unit tests run on in-memory fakes and missed it.
  - New signed-in e2e test `e2e-signed-in/coverage.spec.ts` runs against the real database.
  - Checked that the test fails when the bug is put back.
- Fixed a stale assertion in `escalation.workflow.test.ts`. It failed at HEAD; under §11 the desk alarm now comes before the next ring.
- The local DB had not applied `20261030020000_backup_teams.sql`; it is applied now.

### Tests
- API: 238 unit + 7 workflow tests pass.
- Signed-in console e2e: 6 pass (3 still `fixme`).
- Typecheck, lint and `pnpm check` pass.
- Clicked through in Chrome: add backup (including the refusal when a place has no primary), add, move up, remove, backup → primary.

### Next
- Done in part 3 (above).

## 2026-10-30 · Phase 3, step 7 (part 1): SOS load test, two dispatch fixes, signed-in console e2e

### Load test (`pnpm --filter api load:sos`)
- `apps/api/scripts/load-sos.ts` (local stack only), instead of k6: the same idea with no new binary and no paid service.
  - Raises N simultaneous SOS (default 50) answered by M simulated crews (default 60) through the real API, database and escalation workflow.
  - Reports the latency of raising, of the first offer and of accepting, the accept races lost and any HTTP errors.
  - Checks that every SOS is accepted by exactly one crew and no crew is double-booked.
  - Cleans up through the desk (cancel, or close after the 108 prompt).
- Tokens are signed locally (the API accepts HS256 only with `SUPABASE_JWT_SECRET`, local CLI only; the production config refuses it, which I checked). Local sign-ins are limited to 30 per 5 min.
- **Found and fixed:**
  1. **Postgres connection leak:** each escalation workflow step opened a new database pool that never closed. Under load Postgres ran out ("too many clients"), and the widen / 108 steps failed after 3 retries, so incidents silently stopped escalating. Steps now share one set of dependencies per process.
  2. **One connection per instance:** all concurrent requests queued on it. The pool is now `DB_POOL_MAX` (default 5), and idle connections close after 20 s. Raising and offer polls got 2–3× faster.
  3. **Ring 2 offered 0–2 crews while others were free:** only the 12 nearest crews were looked at before dropping busy ones. Now the 50 nearest (`NEARBY_POOL`). New unit test, which fails without the fix.
- **Results on `next dev`** (a pessimistic upper bound), 50 SOS and 60 crews, no 5xx in any run:
  - accepted: 44–49 of 50
  - raise → first offer: p50 ~5–6 s, p95 ~8 s
  - raise → accepted: p50 ~6–8 s
  - before the fixes: 41/50 accepted, and 9 never escalated

### ⚑ Needs your decision (escalation rule)
- The 1–6 SOS that miss in each run all follow the same pattern: every crew offered in rings 1 and 2 took another job first. After ring 2 **nothing more is offered automatically**; the incident goes to "108 prompted" and waits for the desk to offer it by hand (the desk is alarmed at 30 s). Options:
  - (a) keep this as is
  - (b) after ring 2, keep offering the next nearest free crews every 30 s until someone accepts
  - (c) re-offer earlier rings' crews as they become free

  I recommend (b). It changes the escalation rules, so I haven't built it.

### Signed-in console e2e (`pnpm --filter console e2e:signed-in`, local stack)
- Global setup:
  - seeds an isolated test area: E2E Gardens in Vijayawada, a near and a far hospital
  - resets the test accounts (admin, ER, crew, resident) with fresh passwords
  - enrols TOTP through the Supabase SDK and keeps the secret in `e2e-signed-in/.auth` (git-ignored)
- The sign-in project signs the admin and ER in through the real UI (password + TOTP) and saves their sessions.
- **Passing (5):**
  - admin sign-in
  - ER sign-in, landing on Incoming patients
  - test SOS: raised from the console, accepted by a drill crew, "Drills are never sent to a hospital", cancelled with a reason that shows in the timeline
  - **Realtime blocked → "Live updates paused", and a new SOS still appears by polling** (failure path)
  - ER cannot open the command center or another hospital's handover
- **Marked `fixme` (3), to do next:**
  - real SOS → handover → desk hospital change, and ER open / confirm: the test crew gets no offer for a resident SOS (the drill works). Not diagnosed yet.
  - axe on `/hospitals`: **4 colour-contrast failures**, a real issue to fix in the page.
- Not in CI yet: it needs `supabase start` in a CI job (planned as a separate job, so the red Expo step doesn't skip it).

### Other
- The Android SDK and JDK are now on PATH on this machine, so the emulator / device tests may be possible next.
- CI is still red only on the existing "Expo config and dependency check" step.

### Next
- Fix the 3 `fixme` tests (crew offer; `/hospitals` contrast).
- Add the signed-in suite as its own CI job.
- Your call on the post-ring-2 rule.
- Then device tests.

## 2026-10-30 · Phase 3, step 6c: hospital handover and partner portal

Design written up as plan §10 (within the approved ⚑4; no new kind of health data).

### Done

- **Migration `…_handover.sql`:**
  - `profiles.preferred_hospital_id`
  - `hospitals.address` and `city`
  - `hospital_handovers`: `chosen_by`, `choice_reason`, `preferred`, `updated_at`, and a hospital index
- **Choice on accept (⚑4):**
  - the nearest active hospital with capacity
  - the person's preferred hospital wins if it is at most 10 min further
  - drills never get a handover
  - a job taken again after a reassign keeps its hospital
  - no hospital with capacity: no handover, and a `no_hospital` desk alarm
  - a failure never fails the crew's accept
- **Items** come from consent: everything with `emergency_share`, else blood group only. The name always goes; age and sex go only with the clinical items. Contents are read live at view time, plus the crew's first-aid notes (encrypted).
- **Signed link:**
  - 32 random bytes; only the SHA-256 is stored
  - valid 6 h, and dead once the SOS is cancelled or the hospital changes
  - `GET /v1/handover-links/{token}`: no sign-in, rate limited per client, `no-store`; every view is a `record_shares` row (`hospital_link`)
  - the console page `/handover/{token}` is public in the proxy and sets `referrer: no-referrer`
- **Changing the hospital:**
  - by the assigned crew (`PUT /v1/sos/{id}/hospital`, list at `/v1/sos/{id}/hospitals`) or the desk (`POST /v1/desk/sos/{id}/hospital`)
  - a reason is required
  - a new link is issued and the confirmation is cleared
  - audited with the from and to hospitals
- **Crew:** `POST /v1/sos/{id}/first-aid-notes`
- **Partner portal** (role `hospital`, aal2, scoped by `user_roles` partner → hospital):
  - **Incoming patients**: arrival ETA, refreshes every 15 s
  - the record, logged in `record_shares` on every open
  - **Confirm patient received**: once, audited
  - **ER accepting / full** switch
  - hospital users land there instead of the command center
- **Command center:**
  - the handover box shows the hospital, how it was chosen and why, item names only (no contents), receipt, link expiry and **Call ER**
  - **Choose / Change hospital** action
  - `no_hospital` alarm
- **Hospitals page** (super admin, operations): add a hospital, ER full / accepting, deactivate / activate.
- **Other views:** the resident's SOS view and the crew's job include the handover summary. Resident preferred hospital: `GET/PUT /v1/people/{userId}/preferred-hospital` (the app screen comes with the Android work).
- **`staff:create --scope partner:<hospitalId>|site:<siteId>`** to link hospital and desk staff.
- Strings in en/te/hi (te/hi machine-written).
- Tests: API 231 (21 new: choice rules, record filtering, consent off, preferred hospital, no capacity, drills, partner scoping and aal2, confirm once, link expiry / cancel / redirect / rate limit, admin roles). The repo's lint, typecheck and tests (37 tasks) and `pnpm check` pass.

### Verified in Chrome (local stack, real Postgres)

- The migration applied to the local database.
- A simulated SOS (resident with consent and records): the crew accepted and the handover opened automatically to Care Hospital.
- The command center showed the hospital, the 7 shared items by name, "Not yet confirmed" and Call ER, with no medical contents.
- The signed link showed the full record; one `hospital_link` row in `record_shares`. A random token returned 404.
- The desk changed the hospital with a reason: City Hospital, "Changed by the desk". The old link then returned 404, and both audit rows were present.
- New ER account (TOTP enrolled):
  - landed on Incoming patients with "Arriving in about 12 min"
  - opened the record (logged)
  - Confirm worked: "Received at 18:52"
  - ER full and accepting were both audited
- New super admin: added a hospital, then deactivated it. No console errors.
- Local test data: hospitals Care Hospital Gachibowli / City Hospital Kondapur (Apollo inactive). Staff `er.care@example.test` (now linked to City Hospital) and `admin.cc@example.test`. `resident-sim` has a profile, records and `emergency_share`.

### Not done yet / follow-ups

- **Sending the link to the ER's WhatsApp** needs the notifications module and a utility template. Until then hospitals use the portal. Local development prints the URL in the API log.
- **Field app** screens (hospital choice, first-aid notes, patient summary) and the resident's preferred-hospital picker come with the Android work. `GET /v1/sos/{id}/patient` for the crew is still to build.
- Every server render of the portal record page writes a `record_shares` row (opening, then the refresh after Confirm). This is accurate, but a little noisy.

### Next

- Step 7: load test, failure-path e2e, signed-in Playwright for the console (needs a CI staff account with a known TOTP secret), then device tests.

## 2026-10-30 · Phase 3, step 6b: SOS thresholds and coverage teams

Decision recorded: **reassign restarts the full dispatch sequence** (confirmed by you).

### Done
- **Thresholds (⚑2):**
  - `GET /v1/sos-settings` for everyone who runs the command center (the community desk: its own community only)
  - `PUT /v1/sos-settings/{siteId}` for super admin only: widen 15–60 s, 108 at 60–180 s and after widening; audited with the before and after values
  - incidents copy the values when raised, so a change applies to the next SOS
- **Coverage teams (§9):** `/v1/coverage/*`, super admin and operations only, every change audited.
  - Teams: list (crews with duty, ambulance, what each team covers), create, rename, area label, deactivate / reactivate.
  - Crew members and ambulances: moved in and out of teams; moving one into a team takes it out of its old one.
  - Places: listed with a "not covered" filter and search; assigned or unassigned in bulk. A place covered by another team moves.
  - Refused:
    - homes inside a community (they follow the community's team)
    - inactive teams
    - places that no longer exist
- **Rule hardened:** a household in a community always follows the community's team, in both dispatch and the directory, even if it once had its own assignment.
- **Console:**
  - **SOS thresholds** page (read-only for non-super-admins)
  - **Coverage teams** page and **Assign places** page (checkboxes, select all, one "assign selected to" action)
  - "Covered by" column in the residents directory
  - nav links by role
  - strings in en/te/hi
- **Console forms keep what was typed when the API refuses it.** React 19 resets a form after every `action`, so the error showed next to the old values. Forms now submit by hand and clear only after success; the command-center action forms got the same fix.
- **Bug fixed:** Drizzle leaves select-list columns unqualified in single-table queries, so correlated subqueries bound to the inner table. This gave wrong team household counts and a wrong home-centre fallback for test SOS (`siteCentre`). The outer tables are now named in plain SQL.
- Tests: API 210 (14 new: thresholds scope, bounds, audit, applied to the next SOS; team, crew and ambulance moves; bulk assign, move, unassign; refusals; directory; dispatch follows assignments).

### Verified in Chrome (local stack)
- Super admin:
  - invalid thresholds showed the API's message with the typed values kept
  - 20 s / 75 s saved and marked "Changed"; the audit row was correct
- Coverage:
  - created "ABC team · Gachibowli" and added a crew member and an ambulance
  - assigned Green Meadows; the "not covered" filter dropped it
  - the directory shows "ABC team" for Lakshmi
- A real SOS from Green Meadows used 20 s / 75 s, and its first offers included the ABC team crew (`team_offers: 1`), topped up with the nearest crews.
- Dev note: `simulate:crews` clears crews' team membership when it starts (it rebuilds "Simulated team"), so put crews in teams after starting it.

### Next
- 6c: hospital handover (⚑4 hospital choice, consent-filtered items, signed expiring link) + partner portal confirm.
- Open from 6a: signed-in Playwright for the console (needs a CI staff account with a known TOTP secret); the Expo dependency check that keeps CI red (react-native 0.88.1 and Expo patches need a native rebuild and an emulator run).

## 2026-10-30 · Phase 3, step 6a: console command center

Step 6 is split: **6a** command center (this entry), **6b** per-site thresholds + coverage-teams pages, **6c** hospital handover + partner confirm.

### Done
- **API** (`/v1/desk/*`, module `sos`): staff only (aal2):
  - Who sees what:
    - super admin, operations and support see everything
    - the community desk sees only its own community; another community's incident looks like it doesn't exist
    - support can watch but not act
  - Endpoints:
    - incidents, open or closed in the last day
    - incident detail with timeline and the crews offered
    - fleet: duty, vehicle, current job, last position
    - sites (for test SOS)
  - Actions, all through the state machine as `desk`, so every one lands in `sos_events` and `audit_events`:
    - **cancel** (reason)
    - **reassign** (reason, optional crew)
    - **manual offer** to a chosen free crew
    - **mark handed over** (reason)
    - **close** (reason unless after hand-over)
  - No medical details anywhere in these responses or pushes.
- **Reassign:** takes the job back (→ dispatching) and frees the accept lock so the next crew can accept at once. It starts a **new escalation run** (ring 1 now, widen and 108 at the site's thresholds); a crew the desk picks is offered at once too (ring 0 = "by the desk"). A crew who declined earlier can be offered again; a re-offer gets a new offer id so it rings again.
- **State machine:** one new edge, transporting → handed_over by the **desk with a reason**: the brief lists "mark handed over" for the command center, for when the crew can't (e.g. phone died).
- **Test SOS (⚑5):**
  - raised on the **staff member's own account** for a community, at the community's centre (boundary, else its homes)
  - drill crews only, labelled DRILL
  - never on a resident's account, so a drill can never block their real SOS (one open SOS per person)
- **Live:** every state change, crew position and desk alarm (`raised`, `no_accept` at the widen threshold, `prompt_108`) is also pushed to `desk:{siteId}` and `desk:all`. Migration `…_desk_realtime.sql`: `desk:all` for super admin / operations / support, `desk:{siteId}` for that site's desk, aal2 required.
- **Console home = command center:**
  - live map: relative positions, token colours, SOS pulses, ambulances, dashed route to the job, scale bar; a street map needs the Maps key
  - incident panel:
    - ref, DRILL label, state, open timer
    - resident and home
    - ambulance with ETA, and **Call crew** (company work number)
    - action forms, each needing a confirm and, where required, a reason
    - timeline with reasons
    - crews offered and their answers
  - All clear card with **Run a test SOS**
  - open list, fleet, closed in the last day
  - Live badge, alarm banners, opt-in alarm sound (browsers need a click first), polling 30 s live / 10 s when paused
- Strings in en/te/hi (te/hi machine-written).
- Tests: API 196 + 7 workflow (new: a second escalation run for the same incident after reassign), contracts 34.

### Verified in Chrome (local stack, Realtime on)
- As super admin:
  - Run a test SOS → the "New SOS" alarm arrived by push → a drill crew accepted → map line and ETA
  - reassign with a reason and a chosen crew → back to "Finding a crew", the widen alarm from the new run
  - offer → crew accepted → Call crew shown → crew stepped to handed over → close → "Closed in the last day"
- As a community desk (new TOTP account): Live on its own channel. A real SOS from Lakshmi (Green Meadows B-1204) appeared live with the alarm. An empty reason is blocked; cancel with a reason worked. Leads is hidden. No console errors.
- **Fixed during the run:** a re-offer reused the old offer id, so a client that remembers answered offers (the simulator) never rang again.
- Local test data (local stack only): sites Green Meadows / Palm Grove Villas; Lakshmi Test moved into Green Meadows B-1204; staff `ops.cc@example.test` (operations, not yet signed in) and `desk.green@example.test` (Green Meadows desk).
- Dev only: the Next.js dev badge covers the sidebar's Sign out button at this window size (clicks land on the badge); not in production builds.

### Not done yet / follow-ups
- Playwright for the signed-in command center needs a test staff account with a known TOTP secret in CI; the existing e2e covers signed-out only.
- Desk push / WhatsApp alerts (notifications module) and FCM ringing are still to come; the console alarm is Realtime + polling.
- A sweep for incidents left in `raised` when the escalation run failed to start: they show on the board, but the desk can only cancel them until dispatch begins.

### Next
- 6b: per-site thresholds (super admin, 15–60 s / 60–180 s, audited) and the coverage-teams pages (plan §9).
- 6c: hospital handover (⚑4 choice, consent-filtered items, signed expiring link) + partner portal confirm.

### Needs from you
- Please confirm: **reassign restarts the full dispatch sequence** (nearest crews now, widen at 30 s, 108 prompt at 90 s), on top of offering the crew the desk picks. It never weakens escalation, but it is an escalation rule.
- Unchanged: Google Maps key, Upstash before the first deploy, staff self-sign-up hook decision.

## 2026-10-28 · Phase 3, step 5: resident SOS screens, live tracking, fallbacks

### Done
- **API:**
  - Live updates over Supabase Realtime Broadcast (REST endpoint, so the API never holds a socket): every state change goes out as `state` on the private channel `sos:{id}`, whoever made it (resident, crew, desk, workflow), and crew positions go out as `position` during an active job. Payloads carry no medical details. A failed push never fails the change behind it.
  - Needs `SUPABASE_SECRET_KEY` (now required in production); without it nothing is pushed and the apps poll.
  - Resident SOS endpoints return `ResidentSos`: the incident plus, while a crew has the job, the ambulance (registration, life-support level), the company work number, its last position, and distance / ETA (straight line × 1.4 at 25 km/h until Google Routes). No crew names or personal numbers.
  - Distance and ETA formulas moved into `@repo/contracts/sos`, so the app updates them from position pushes with the same maths.
  - 5 new tests (API 174 + 6 workflow).
- **Migration `…_sos_realtime.sql`:** only the person and their family managers may listen on `sos:{id}`. It reuses the `sos_incidents` RLS policy.
- **Resident app:**
  - Home SOS card opens a 5 s countdown with "Send alert now" / "Cancel, I'm OK". Location: last known at once, then a fresh fix; the alert never waits for GPS.
  - Raising uses one idempotency key per press, 4 s per attempt, and retries with backoff. After the first slow or failed attempt, "Call community desk" (number saved on the phone) and "Call 108" appear while retries continue. Back is blocked while sending.
  - Live screen:
    - state and elapsed timer
    - relative map: your position and the ambulance's bearing and distance. A street map needs the Google Maps key.
    - ETA card with registration and "Call ambulance crew" (work number)
    - step list with times
    - 108 banner on escalation
    - DRILL label
    - "live updates paused" note when the channel is down
    - cancel with confirmation while allowed
  - Polling: every 5 s while the channel is down, every 30 s while it is up.
  - Home shows "SOS active · …" while an incident is open.
  - **Startup error screen now has "Call 108" / "Call community desk".** Before this, a resident opening the app while the service was unreachable got only "Something went wrong".
  - `expo-location` added (while-in-use only; no background location in the manifest). Strings in en/te/hi (te/hi machine-written).
- **Simulator:** `--drive` (the winning crew drives to the patient, streaming fixes, then on scene → transporting → handed over) and `--speed` (m/s; default 11, use 100 for quick runs).

### Verified on the Android emulator (local stack, Realtime on)
- Countdown → raise → "Finding an ambulance" → widen at 30 s → **"Call 108 now" at 90 s**, shown about 3 s after the server event → cancel with confirmation → "SOS cancelled".
- With 3 simulated crews: one accepted, the other two got 409. Ambulance bearing and distance went 7.0 → 0 km. **On-screen distance tracked the simulator fix by fix (6292 m → 6.3, 6204 m → 6.2 within 10 s), faster than polling could, so the Realtime pushes arrive.** Private channel joined, so the RLS policy works.
- Registration, life support and "Call ambulance crew" (opened the dialer with the work number); on scene → transporting → handed over; home "SOS active" card; startup error screen with Call 108 (API stopped).
- Fixed during the run: cancel confirmation hidden below the fold; ETA wrapping; map label clipped / over the route; on-scene card said "arriving in"; after hand-over the screen fell back to "Looking for an ambulance"; last step shown in progress instead of done.

### Same day: location asked during onboarding (your decision)
- New last onboarding step **"Let help find you"**: "Allow location" shows the system prompt, "Not now" moves on. Either answer completes the step; anyone who said "Not now" is asked again by the system at their first SOS. Stored on the phone (it is the phone's permission, not a consent record). Existing users see it once.
- Verified on the emulator: permission revoked → step shown → allow → home → SOS countdown opens with no prompt.
- Also fixed: the SOS timer froze at 0:00 when the phone clock was behind the server (the emulator was ~1 min behind); it now starts no later than when the phone first saw the SOS.
- **Slow raise seen for real:** right after an API restart, two raise attempts failed with a 500 before the third landed (201). The app showed "Still trying… Call 108" during the retries and only one incident was created: the fallback path working as designed. The cause of the 500s did not reproduce; the API now logs the error message in local development only, so the next occurrence shows it.
- The dev build froze ("isn't responding") twice when it lost its connection to Metro under load (logcat: dev-client websocket reconnects). Development tooling only; not in release builds.

### Same day: open items closed
- **The 500s on POST /v1/sos, found and fixed.** Reproduced with two SOS requests at the same moment (a retry overlapping a slow first attempt, or two presses). The database correctly refused the second open incident, but `raise()` checked `err.code` for 23505 and Drizzle puts the Postgres code on `err.cause`, so the race fell through to a 500. The same bug was in the lead-reference retry. Fixed with `pgErrorCode` / `isUniqueViolation` in `@repo/db`; the test fakes now throw errors wrapped like Drizzle's. Re-run against the real database: 3 simultaneous requests → one 201, two 200, one incident (same key and different keys).
- **SOS with the network completely down.** The raise loop moved out of the hook into `apps/resident/lib/raise.ts` and is unit-tested (the resident app now has vitest; 5 tests run in CI): fallbacks at once when unreachable, abandon a hung request at 4 s, retry with backoff, stop on refusal, stop when the screen closes. On the emulator with airplane mode: Call 108 within 4 s, offline ~20 s, SOS landed 17 s after the network returned, exactly one incident.
- Maestro flow `apps/resident/.maestro/sos-offline.yaml` (airplane mode) written with test IDs on the SOS buttons. **Not run yet: installing Maestro needs your OK** (download from GitHub, see README).
- Tests: API 177 + 6 workflow, resident 5.

- **Maestro 2.12.0 installed** (`%LOCALAPPDATA%\maestro\bin\maestro.bat`, not on PATH). **`sos-offline.yaml` passes on the emulator (12/12 steps).**

### Not verified yet
- `sign-in.yaml` (both apps): `clearState` also wipes the dev build's Metro address, so the resident flow now reconnects when run with `-e DEV_SERVER=http://10.0.2.2:8081` (release builds need nothing). Not passing yet: on this laptop Maestro hung connecting to the emulator under load (emulator + Docker + API + Metro). Retry with fewer things running; the field app's flow needs the same change.

- **Retry the moment the network returns (approved):** `@react-native-community/netinfo` 12.0.1 (via `expo install`). The backoff wait is cut short on an offline → online change (not on every network event; unknown counts as online), including when the network returns mid-request. 2 more unit tests (resident: 7). On the emulator: offline ~25 s, then the SOS landed **2.7 s** after the network returned (17 s before), one incident. Native module: rebuild dev clients (`expo prebuild` + `expo run:android`).
- iOS (needs a Mac or EAS + Apple account).

### Notes and follow-ups
- The home screen needs the API to load. A resident offline at launch now gets the phone fallbacks, but can't raise an in-app SOS until the service is reachable. An offline-capable home (cached profile) would fix this.
- "Hospital handover" card is a placeholder until step 6.

### Next
- Step 6: console command center (live map, incident panel, reassign, test SOS, thresholds, coverage teams), hospital handover + partner confirm, desk channel `desk:{siteId}`.

### Needs from you
- Unchanged: Google Maps key (sandbox; also turns the relative map into a street map), Upstash account before the first deploy, staff self-sign-up hook decision.

## 2026-10-28 · Phase 3, step 4: field app (duty, offers, job steps, location)

### Done
- **API:**
  - `GET /v1/crew/job`: the job a crew has taken, with the next status button (no medical details)
  - `POST /v1/sos/{id}/status`: en route → on scene → transporting → handed over, assigned crew only, one step at a time; pressing the same step again is a harmless retry
  - going off duty mid-job is refused (409); the desk reassigns instead
  - `nextCrewStep` and `crewSteps` added to the shared state machine
  - 10 new tests (API 169 + 6 workflow; contracts 30)
- **Field app (crew):**
  - duty switch through the API, with a location fix capped at 8 s so GPS never blocks going on duty
  - polls offers every 3 s while on duty, free and in the foreground
  - full-screen vibrating "Emergency job" ring with distance/ETA, DRILL label, accept / decline ("another crew took it" on 409)
  - job card with Google Maps hand-off and one big status button per step
  - notice when the desk cancels or reassigns a job
  - other field roles see "jobs for your role arrive in a later update"
- **Location:**
  - standby: foreground-only updates every 30 s / 50 m
  - active job: background task every ~4 s through an Android foreground service (persistent notification) plus an in-app "Sharing your location" indicator; stops at hand-over, cancel or reassign
  - Android needs only while-in-use permission; no "Allow all the time" (no background-location permission in the manifest)
- Strings in en/te/hi (te/hi machine-written, still need native review).
- **Verified on the Android emulator** against the local stack: sign-in as crew, on duty, real SOS raised → ring screen → accept → four status steps → timeline `raised → dispatching → accepted → en_route → on_scene → transporting → handed_over` (crew steps by `crew`), 6 background location fixes received, back to standby.
- **Fixed on device:** a crash right after accepting (expo-task-manager needs `RECEIVE_BOOT_COMPLETED`), and going on duty hanging on a GPS fix.

### Notes
- Patient summary and first-aid notes are stored on the hospital handover, so they come with step 6 (handover), not here.
- The job location service is killed with the app (`killServiceOnDestroy`); reopening the app restarts tracking. Ringing with the app closed needs FCM push (comes with the push setup).
- `expo install --fix` wanted expo 58.0.20 / expo-router 58.0.27 / expo-dev-client 58.0.16. It did that by adding exclusions to pnpm's release-age gate, so I reverted it. CI's `expo install --check` will flag these patches until they pass the age gate; then run `npx expo install --fix` in both apps.
- After `expo prebuild`, copy `apps/resident/android/local.properties` into `apps/field/android/` (prebuild deletes it).
- Local test data: crew record for +91 99999 00002 (drill participant, in "Simulated team").

### Next
- Step 5: resident SOS screens (countdown, live tracking over Realtime with polling fallback, crew call to the work number, 108 / desk fallbacks), and broadcasting crew positions on the incident channel.

### Needs from you
- Unchanged: Google Maps key (sandbox), Upstash account before the first deploy, the staff self-sign-up hook decision.

## 2026-10-27 · Phase 3, step 3: dispatch with coverage teams (core done)

### Done
- **Coverage teams** (plan §9, approved): migration `…_coverage.sql`: `coverage_teams`, `coverage_assignments` (one team per site or stand-alone household, enforced by unique keys), `crews.team_id`, `ambulances.team_id`.
- **Who is offered:**
  - ring 1 is the household's team (nearest first; team crews without a position still get it), topped up with the nearest other crews to three
  - ring 2 at the widen threshold: the next nearest
  - drills: drill crews only
  - skipped: off-duty, inactive, busy and already-offered crews
  - no GPS: the home's location
- **Live positions:** Redis GEO (`geo:crews:on_duty` + `pos:crew:{id}`, stale after 10 min). In-process locally, shared by request handlers and workflow steps.
- **First accept wins:** Redis lock plus the state compare-and-set; other offers released; escalation run signalled. Decline.
- **Endpoints:** `GET /v1/crew/me`, `PUT /v1/crew/duty`, `POST /v1/crew/location`, `GET /v1/crew/offers`, `POST /v1/dispatch/offers/{id}/accept|decline`. Crews see location and distance only, never medical details.
- The escalation workflow now sends real offers (desk alarm and 108 prompt still logged).
- **Simulated crews:** `pnpm --filter api simulate:crews --count 5 --team 2 --sos`. Verified on the local stack: team crews plus the nearest other crew offered, one accept wins, others released, timeline `raised → dispatching → accepted`.
- **Tests:** 18 new; API total 161, plus 6 workflow tests.

### Not yet
- Google Routes ETAs (straight-line × 1.4 at 25 km/h until a Maps key is configured).
- Ringing push to crews comes with the field app (step 4); until then crews poll `GET /v1/crew/offers`.
- Console screens for teams and assignments (step 6).
- Load test (step 7).

### Next (tomorrow)
- Step 4, field app: duty switch on the API, ringing offer screen with accept/decline, status buttons, location streaming.

### Needs from you
- Google Maps API key (sandbox) for road ETAs.
- Upstash Redis account before the first deploy.
- Staff self-sign-up hook decision (open question above).

## 2026-10-27 · Resident app on Android (emulator)

### Done
- First Android development build of the resident app on an API 37 emulator. Clicked through it against the local API and Supabase: phone OTP sign-in (test number), onboarding (profile, own home, consent), Home, Health (logged a BP reading → 128/84 "Elevated").
- **Fixed:**
  - `verify` crashed when opened without a phone number (the router's first signed-out screen on launch); it now redirects to sign-in (resident and field).
  - The bottom sheet ("Log a reading") stayed under the keyboard on Android, hiding the fields and Save; it now lifts by the keyboard height. Reading fields capped at 6 characters.
- **Local setup:** phone login needed a placeholder SMS provider in `supabase/config.toml` (the CLI ignores the send-SMS hook); `virtualStoreDirMaxLength: 24` shortens pnpm store paths; README covers the Windows Android setup (JDK 17, long paths, CMake/Ninja).

### Finishing pass (same day)
- Resident: Profile (emergency contact added, family invite sent with masked number, privacy toggles, consent history), Bookings and Records (placeholders, as planned). Home shows the logged BP.
- Fixed: page forms could leave fields under the keyboard (edge-to-edge); pages now use `KeyboardAwareScrollView` (`react-native-keyboard-controller` 1.22.7, with `react-native-reanimated` 4.7.1, versions from `expo install`).
- Field app: first Android build; sign-in, the "field staff only" message without a role, then home with the crew role and the duty switch (persisted in step 4).
- **Coverage teams** requested: ops manually assign each community, building or stand-alone home to one crew-and-ambulance team (no overlaps); priority-first offers; ops/super admin manage them. Planned in `docs/plans/phase-3-sos.md` §9, approved.

### Next
- Phase 3 step 3 (dispatch), including coverage teams (§9 approved).

## 2026-10-27 · Phase 3, step 2: Workflows host and SOS escalation

### Done
- **API on Next.js (plan ⚑1):** `apps/api` is now a thin Next.js 16 app whose catch-all route (`app/[[...path]]/route.ts`) hands every request to the unchanged Hono app. `withWorkflow` adds the Workflow routes. `src/index.ts` and `src/dev.ts` are gone; `pnpm --filter api dev` still serves port 3001 and reads the root `.env`. CI now builds the API too.
- **Escalation workflow** (`workflow` 5.2.3), one durable run per SOS (`modules/sos/escalation.ts`):
  - raised → dispatching, desk alarm, offer ring 1
  - no accept by the site's first threshold (default 30 s): offer ring 2 and alarm the desk to dispatch manually
  - by the second (default 90 s): `escalated_to_108` with a reason, prompt 108; dispatch stays open (2 h) for a late accept
  - stops as soon as the incident settles: an accept or cancel resumes the run's hook (`sos-escalation:{id}`); every step re-reads the state, so a lost signal is harmless
  - ids only in workflow inputs and logs; non-state actions (offer rings) go to `audit_events`
- `POST /v1/sos` starts the run and stores its id (a failure to start never fails the SOS; it is logged). Cancel signals the run.
- **Accept** (`acceptForCrew`): compare-and-set assigns the crew; one winner among simultaneous accepts. The endpoint and Redis lock come with dispatch (step 3).
- Alerts are a `SosAlerts` interface, logging for now; step 3 swaps in real offers, console alarms, push and WhatsApp.
- **Tests:** 13 new unit tests, plus 6 whole-workflow tests on the Workflow runtime with simulated crews and fast-forwarded sleeps (accept before 30 s; widen then 108; accept after 108; cancel; three simultaneous accepts; missed signal). Total API: 149.
- **Verified locally** on the real stack: an SOS widened at +31 s and escalated at +91 s, with timeline and audit rows.
- Fixed local setup: staff password sign-in (email provider was disabled by `[auth.email] enable_signup = false`); `SUPABASE_JWT_SECRET` must stay empty with the current Supabase CLI.

### Notes
- Workflow tests load our workspace packages through a test-only Node resolve hook (`test/workflow-setup.ts`); Next builds bundle them normally.
- Workflow tests keep their own data dir; sharing `.workflow-data` with the dev server let test setup wipe live local runs.
- Not yet tested: API restart mid-run (needs a deployed or long-running environment; plan §7).

### Next
3. Dispatch: Redis GEO shortlist, Routes ETAs, `dispatch_offers`, accept/decline endpoints with the atomic lock, real alerts; a simulated-crews script for e2e and load tests.

### Open questions
- Staff self sign-up: the Supabase email provider must be on for staff password sign-in, so anyone could create an email account (it gets no console role and is turned away). Close it fully with a `before_user_created` hook? Also check the production project's setting.

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
Local stack runs (Docker). Create staff with `pnpm --filter api staff:create --email … --role super_admin`, then TOTP set-up on first sign-in.

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
