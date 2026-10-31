# Plan: Phase 3 (SOS and the field app)

Status: **approved 2026-10-27**: all recommendations accepted (⚑1 Hono served from a thin Next.js app for Workflows; ⚑2 30 s / 90 s per-site thresholds; ⚑3 own + partner ambulances; ⚑4 preferred hospital within +10 min; ⚑5 drills only to drill crews, no external messages; ⚑6 work-number call first, in-app voice in Phase 4; ⚑7 accounts approved, sandbox keys until launch). **Your actions outside the code:** apply for Apple Critical Alerts; Play Store full-screen-intent and foreground-location declarations at submission.

SOS must never fail silently: an alert reaches a human within seconds, even on a weak network, and every step is recorded.

---

## 1. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| ⚑1 | **How to run Vercel Workflows** (the durable 30 s / 90 s escalation timers). The Workflow SDK's documented Hono setup needs **Nitro, whose only release is a 3.0 beta**. Its Next.js setup (`withWorkflow`) is documented and Next is stable. | Keep the Hono API exactly as it is, but **serve it from a thin Next.js app** (`apps/api` gets a catch-all route that hands every request to Hono). Workflows then use the stable Next.js integration. It's still Hono on Vercel Functions in bom1, so not a stack change in substance, but it changes how the API is built, so I'm asking. The alternative is Nitro 3 beta under Hono. |
| ⚑2 | **Escalation thresholds.** Brief: widen at 30 s, prompt 108 at 90 s, configurable. | Defaults 30 s / 90 s, adjustable **per site** by a super admin in the console, between 15–60 s and 60–180 s. Every change is audited. |
| ⚑3 | **Whose ambulances.** | The data model supports both our own fleet and partner operators (`ambulances.operator`). For the pilot: whichever ambulances are enrolled and on duty in the field app. Operational choice, no code impact. |
| ⚑4 | **Which hospital receives the patient.** Brief: nearest with capacity, or the resident's preferred one. | The preferred hospital if it has capacity and its ETA is at most 10 minutes worse than the nearest; otherwise the nearest with capacity. The crew can override with a reason (logged). |
| ⚑5 | **Test SOS (drills).** | Run from the console by super admin / operations, or by the community desk for its own site. Offered only to crews marked as drill participants. Family and hospitals get **no** messages. Everything is labelled DRILL on every screen and in every record, and never counts in reports. |
| ⚑6 | **In-app crew call.** The brief puts calling (LiveKit) in Phase 4, but the SOS screen needs a crew call. | Phase 3 ships the brief's required fallback first: a one-tap phone call to the **crew's company-issued work number** (never personal numbers), with in-app voice added when the calls module lands in Phase 4. |
| ⚑7 | **Paid services this phase turns on**, all in the decided stack: Upstash Redis (GEO + locks), Google Maps Routes API (ETAs) and Maps SDK, Vercel Workflows usage, FCM/APNs (free). | Approve the accounts; use test/sandbox keys until launch. **Outside the code:** Apple's Critical Alerts entitlement (apply now, approval takes time) and the Play Store full-screen-intent / foreground-location declarations. |

---

## 2. State machine (server-side, `sos` + `dispatch` modules)

`countdown` (on the phone only) → `raised` → `dispatching` → `accepted` → `en_route` → `on_scene` → `transporting` → `handed_over` → `closed`, plus `cancelled` and `escalated_to_108`.

- Transitions are allowed only along these edges; each is one row in **`sos_events`** (who, when, from → to, reason), and an `audit_events` row.
- `cancelled`: by the resident during or after the countdown, or by the desk with a reason.
- `escalated_to_108`: at the 90 s threshold with no acceptance. Dispatch can still continue if a crew accepts later.
- Idempotency: `POST /sos` carries a client key; retries never create a second incident.

## 3. Flow (as the brief, with the parts that make it reliable)

1. **Trigger:**
   - The resident app opens a 5 s cancellable countdown with "Send now".
   - It grabs the last-known location at once, then a fresh high-accuracy fix.
   - Home-screen SOS card first; the lock-screen widget follows after the first device test.
2. **Raise:**
   - `POST /v1/sos` with an idempotency key.
   - If no answer in 4 s, it retries with backoff and **at the same time shows "Call community desk" and "Call 108"** (phone dialer). The UI never waits on the network.
3. **Notify in parallel:**
   - Console alarm (Realtime + sound), push and WhatsApp to the desk.
   - Family push + WhatsApp; SMS if WhatsApp isn't delivered in 60 s (a workflow step); no medical details.
   - Gate security when the household is in a community.
4. **Dispatch:**
   - Redis GEO shortlist of on-duty crews near the location → Google Routes ETAs → offer to the **nearest 3 at once** (critical push + ringing screen).
   - **First accept wins** through an atomic Redis lock; the others get "taken".
5. **Escalation**, as one Workflow run per incident:
   - Wait for the accept hook or 30 s → widen to the next ring and alarm the desk to dispatch manually.
   - Wait until 90 s → prompt the resident and the desk to call 108 and mark `escalated_to_108`.
   - Thresholds come from the site's settings (⚑2).
6. **Track:**
   - The field app sends location every 3–5 s during an active job (Android foreground service, iOS background location).
   - The API updates Redis and broadcasts on the incident's private Realtime channel.
   - The resident app and console show the ambulance, route and ETA, refreshed every 30 s.
7. **Hospital handover:**
   - On accept, the hospital is chosen (⚑4) and gets a **time-limited, signed handover link**.
   - Contents: blood group, allergies, conditions, medicines, last vitals, emergency contacts, insurance. **With `emergency_share` off: blood group only.**
   - The ER confirms receipt in the partner portal. Every disclosure goes to `record_shares`.
8. **Close:**
   - The crew marks on-scene → transporting → handed-over; the desk closes; family get a final update.

## 4. Data model (migration `…_sos.sql`, with RLS)

- `ambulances` (registration, operator, equipment level, work phone)
- `crews`, `crew_shifts` (on/off duty, standby point)
- `standby_points` (PostGIS)
- `hospitals` (location, capacity flags, ER phone)
- `sos_incidents`:
  - household, resident, location (geography point), accuracy, state, site
  - `is_drill`
  - assigned crew / ambulance, hospital
  - thresholds used, workflow run id
- `sos_events` (append-only)
- `dispatch_offers` (crew, offered_at, ring, response, responded_at)
- `hospital_handovers` (items shared, link expiry, confirmed_at, confirmed_by)
- `site_sos_settings` (thresholds, gate-security contacts)

Redis:
- `geo:crews:on_duty` (positions)
- `lock:incident:{id}` (first accept)
- `pos:crew:{id}` (last position + timestamp)
- rate limits on `POST /sos`

Realtime: private channels `sos:{incidentId}` (resident, family managers, assigned crew, desk, care team), `desk:{siteId}` (alarms), `crew:{crewId}` (offers). Authorized by Supabase Realtime RLS.

## 5. API

- **Resident:**
  - `POST /v1/sos` (raise, idempotent)
  - `POST /v1/sos/{id}/cancel`
  - `GET /v1/sos/{id}` (state, timeline, crew, ETA, what was shared with the ER)
- **Field:**
  - `PUT /v1/crew/duty` (on/off duty)
  - `POST /v1/crew/location` (batched)
  - `POST /v1/dispatch/offers/{id}/accept|decline`
  - `POST /v1/sos/{id}/status` (en_route…handed_over)
  - `POST /v1/sos/{id}/first-aid-notes` (added to the handover)
  - `GET /v1/sos/{id}/patient` (allergies, conditions, medicines: **only while assigned and active**)
- **Console:**
  - incidents list / detail with timeline
  - reassign, manual dispatch, mark handed over, close
  - **test SOS**
  - per-site thresholds
  - fleet status
- **Partner (hospital):**
  - incoming handovers with arrival ETA
  - confirm receipt
  - handover link view (signed, expiring)

## 6. Screens

- **Resident app:**
  - countdown sheet
  - live SOS screen: map with ambulance, ETA, timeline, crew call (work number), what was shared with the ER, cancel
  - the network-failure fallback buttons
- **Field app:**
  - role home with duty toggle
  - incoming job ring screen with accept / decline
  - navigation hand-off to Google Maps
  - status buttons
  - patient summary (active job only)
  - first-aid notes
  - visible "sharing location" indicator
- **Console:**
  - **command center** from the design: live emergency map, active incident panel with handover record, reassign, call crew, mark handed over, test SOS, fleet status
  - incident timeline
- **Partner portal (hospital):** incoming handovers and confirm.

## 7. Tests (brief: failure paths too, load test, simulated crews)

- **Unit:** every state transition and every illegal one; threshold maths; hospital choice; handover item filtering by consent.
- **Workflow:** accept before 30 s; no accept → widen at 30 s → 108 at 90 s; accept after escalation; cancel during dispatch; API restart mid-run (durable sleep resumes).
- **Concurrency:** 3 crews accept within the same millisecond → exactly one wins.
- **Failure paths:**
  - POST /sos times out → fallbacks shown, retry lands once (idempotency)
  - no crews on duty → immediate desk alarm
  - WhatsApp undelivered → SMS at 60 s
  - Realtime disconnect → polling fallback
- **End-to-end with simulated crews:** a script runs N fake crews that go on duty, move, accept and update status; used by the e2e suite and the **load test** (k6, local, no paid service) for, e.g., 50 simultaneous incidents in one city.
- **Maestro** (resident SOS, field accept-to-handover) and **Playwright** (command center, test SOS).

## 8. Order of work once approved

1. Migration + state machine + `sos_events` (with unit tests)
2. ⚑1 setup (Workflows) + escalation workflow with simulated crews
3. Dispatch (Redis GEO, Routes ETAs, offers, atomic accept)
4. Field app: duty, ringing offer, accept, status, location streaming
5. Resident SOS screens + Realtime tracking + fallbacks
6. Console command center + test SOS + thresholds; hospital handover + partner confirm
7. Load test, failure-path e2e, device tests (needs Android Studio / a real phone)

---

## 9. Coverage teams (added and approved 2026-10-27)

Ops **manually** assign who covers whom: a **coverage team** (crew members and their ambulance, e.g. "ABC team, Gachibowli") covers a list of gated communities, apartment buildings and stand-alone homes. Every household is covered by **at most one team**, so there are never overlaps. An SOS from a covered household is offered to its team first. Decided: priority first (the 30 s widen still applies); managed by super admin and operations; the community desk can see which team covers its community but not change it.

**Data** (migration, RLS, every change in `audit_events`):
- `coverage_teams`: name, area label (free text, e.g. "Gachibowli"), active. A team covers **any number** of places (one team → many communities, buildings and homes; each place → at most one team). A crew member covering places on their own is a one-person team.
- Team members: `crews.team_id` and `ambulances.team_id` (a crew or ambulance belongs to one team at a time).
- `coverage_assignments`: team + **either** a site (gated community or apartment building) **or** a stand-alone household. Unique per site and per household, enforced by the database, so a second team cannot be assigned to the same place.
- Households inside a site follow the site's team. Only households without a site are assigned individually.

**Dispatch** (step 3):
- The team comes from the SOS's household (its site, or the household itself). No GPS needed for this.
- Ring 1 = the team's on-duty crews, nearest first, up to 3 (see ⚑9). Ring 2 at the widen threshold = the nearest other crews, as today. Uncovered households: ring 1 is the nearest 3, as today. Drills: drill crews only.

**Console** (step 6, with the command center):
- **Coverage teams** page: each team with its crews, ambulance, on-duty count and how many households it covers; create/rename/deactivate a team; add or remove crews and the ambulance.
- **Assign** communities, buildings and stand-alone homes to a team (searchable list, bulk select; filter "not covered by any team" so gaps are visible). Moving a place to another team is one action, audited.
- Residents directory and the community page show the covering team.

**Decided:**
- ⚑9: when fewer than 3 of the team's crews are on duty (or none), the first offer is filled with the nearest other crews at once; a short-staffed team never costs the resident 30 s.
- A crew member belongs to one team at a time (simplest; can become many-to-many later if crews work shifts for two teams).

---

## 10. Hospital handover (step 6c, within ⚑4 as approved)

How the approved handover (§3.7, ⚑4) is built. No new kind of health data: the handover reads the existing record, filtered by `emergency_share`.

- **Choice on accept** (not drills: hospitals get nothing for a drill). Candidates: active network hospitals with capacity, ETA from the patient's location (straight line × 1.4 at 25 km/h until Google Routes). The person's **preferred hospital** (`profiles.preferred_hospital_id`, set by them or a family manager) wins if it has capacity and its ETA is at most 10 min worse than the nearest; otherwise the nearest. No hospital with capacity → no handover, the desk is alarmed.
- **Override** by the assigned crew or the desk, with a reason (timeline + audit). The handover moves to the new hospital with a new link; the old link stops working.
- **Items** fixed at creation from consent: everything in `handoverItems` with `emergency_share` granted, else blood group only. Contents are read from the live record at view time (latest vitals), limited to those items, plus the crew's first-aid notes (encrypted at rest).
- **Link**: random 32-byte token, only its SHA-256 stored; valid 6 h from creation; dead once the SOS is cancelled. `GET /v1/handover-links/{token}` needs no sign-in (ER staff on a shared screen), is rate limited, and every view writes `record_shares` (viewer role `hospital_link`). Delivery to the ER's WhatsApp comes with the notifications module (needs a template); until then the hospital sees it in the partner portal.
- **Partner portal** (console, role `hospital`, aal2, scoped by `user_roles` `partner` → `hospitals.id`): incoming handovers with arrival ETA, the record (each open is a `record_shares` row with the staff id), **Confirm receipt** (once, audited), and an **ER accepting / full** capacity switch.
- **Command center**: the handover record (hospital, ER phone, items shared by name only, link expiry, confirmed at). No contents: the desk sees no medical detail.
- **Resident**: the SOS screen shows the hospital and what was shared.
- **Hospitals page** (super admin, operations): add, edit, capacity, deactivate.

---

## 11. Change of plan: no 108; primary + ordered backup crews (requested 2026-10-30, approved)

Your answers: remove 108 completely; on no response, alert and offer the backup automatically; an **ordered list of backups** per place; timeout per community, default 30 s.

**Coverage (Coverage pages, super admin / operations, audited)**
- Each community, building or stand-alone home has a **primary team** and an **ordered list of backup teams** (backup 1, backup 2, …). The same team cannot appear twice for one place; a team can be primary for some places and a backup for others.
- Homes inside a community follow the community's list (as today).
- The **Assign places** page gets "Set as primary" / "Add as backup"; the place shows "Primary: ABC · Backups: 1. XYZ, 2. PQR", reorderable.

**Dispatch sequence (replaces widen / 108)**
1. **0 s:** offer the primary team's on-duty crews, topped up with the nearest free crews to 3 (as ⚑9 today). The desk gets the "New SOS" alarm.
2. **Every timeout (per community, default 30 s, 15–60 s on the thresholds page) with no accept:**
   - alarm the command center **and admins** ("SOS-xxxx: ABC team did not respond, offered to XYZ"), with sound
   - offer the next backup team in order
   - earlier offers stay open: whoever accepts first gets the job
3. **After the last backup:** keep offering the next nearest free crews every timeout, until someone accepts or the desk acts. The desk alarm repeats each time (rather than stopping as after ring 2 today). This also covers the gap the load test found.
4. **Reassign:** restarts this sequence. The desk can always offer any crew by hand.

**108 removed**
- No `escalated_to_108` step, no "108 prompted" alarm, and no 108 threshold. The thresholds page keeps one value: "Next crew after (s)".
- Existing history keeps the old state for past incidents; new incidents never enter it.
- The resident and console screens drop every "Call 108" button.
- **No-network fallback (decided):** the resident app shows **"Call community desk"** with a number set in the admin console (see below), instead of 108.

**Community desk number (decided 2026-10-30)**
- One number, set by the super admin in the console (Settings → "Community desk number"), audited. It starts as a placeholder (empty: the button is hidden and the console shows a warning until set).
- Every resident app reads it from a public config endpoint and **keeps the last value on the phone**, so it still works when the app can't reach our servers. A change reaches phones the next time they are online.

**Hospital chosen by the crew (decided 2026-10-30, replaces the automatic choice in §10)**
- After accepting, the crew sees the **empanelled hospitals sorted by distance from the patient's location** (the resident's phone location, else their home or community), with ETA, ER full / accepting, and the resident's preferred hospital marked.
- The crew picks one. The handover (consented record, signed link, partner portal) opens **when the crew picks**, not automatically on accept. The crew can change it with a reason, as today.
- Until the crew has picked, the command center shows "Hospital not chosen yet"; the desk can also pick, with a reason.
- Confirmed 2026-10-31: no automatic hospital at all; the crew picks (no pre-selected suggestion).

**Tests:** sequence timing (primary → backup 1 → backup 2 → nearest crews), alarms at each step, ordered-list rules (no duplicates, removal and reorder), late accept by an earlier team, and the load test re-run.

**Order of work once approved:** migration (backup ranks on coverage assignments, thresholds simplified, 108 removed from the state machine for new incidents) → workflow → console (coverage lists, alarms, thresholds) → resident app strings and buttons → tests and load test.

## 12. Crew patient summary (decided 2026-10-31)

- The crew sees **the same items as the ER handover**, following the resident's `emergency_share` consent: with it on, blood group, allergies, conditions and current medicines; with it off, blood group only. (Contacts, insurance and vitals stay with the hospital.)
- Visible in the field app **only while this crew has the job** (accepted → transporting), never for drills.
- Every view is logged in `record_shares` (viewer = the crew member, role `crew`, with the incident).
- First-aid notes typed by the crew go into the handover (encrypted at rest), as already built.

## 13. SOS notifications (decided 2026-10-31)

Your answers: **family = the resident's emergency contacts only**; WhatsApp needs an opt-in, so **the resident confirms the contact agreed** when adding them.

- **Opt-in:** adding or editing an emergency contact has a tick, "They agree to get emergency alerts from us on WhatsApp or SMS". Ticked → a `messaging_optins` row for that phone (source `confirmed_by_resident`, who and when). Unticked contacts are saved but get no alerts, and the app says so. A STOP reply opts the number out, as today.
- **On raise** (real SOS only, never drills), one durable workflow run per incident:
  1. WhatsApp alert to every opted-in emergency contact: "{{name}} has raised an emergency alert. Help is being sent." (no medical details).
  2. WhatsApp alert to the community desk number (console Settings), and to the community's gate phone when set (security can open the gate).
  3. After 60 s: any of those not delivered or read on WhatsApp gets the same alert by SMS (DLT template).
- **Final update** to the same contacts when the crew hands over at the hospital ("…has been taken to {{hospital}}") or the SOS is cancelled ("…is safe; the alert was cancelled").
- **Gate phone:** set per community on the SOS timeout page (the column exists).
- **Push** to the desk and family apps comes with FCM / APNs (later); the console already sounds the alarm.
- Templates go in the versioned catalogue; WhatsApp and SMS run in log mode until Meta and MSG91 are set up. Template names avoid the product name.
