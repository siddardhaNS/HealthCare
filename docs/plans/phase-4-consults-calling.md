# Plan: Phase 4 (consults and calling)

Status: **⚑ awaiting approval** (written 2026-10-31). Brief dates: 22 Dec – 18 Jan.

A resident books a doctor by specialty and slot, pays, waits in a waiting room, has a video or audio call (or goes to the clinic), and gets an e-prescription in Records. All calls in the product run on one `calls` module: consults, the SOS crew call, the desk call, and later the service calls. Incoming calls ring like a phone call, even with the app closed.

Built in the agreed order: **API and web first** (doctor portal, console), then Android, then iOS. Provider set-up (LiveKit, Razorpay, FCM / APNs) happens alongside, and test keys are used until launch.

---

## 1. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| ⚑1 | **How doctors join.** | Operations creates the doctor in the console (name, specialties, **medical council registration number** and council, clinic address for in-clinic, fee, languages, photo), and checks the registration manually against the NMC / state register before turning them on. The doctor signs in to the partner portal with email + TOTP (as staff do today). No self-sign-up for the pilot. |
| ⚑2 | **Fees and when the resident pays.** | The fee is set per doctor (and optionally per consult type). The resident **pays when booking** (Razorpay order: UPI / card), and the slot is held for 10 min while paying. If the doctor cancels or doesn't join within 15 min, there's an automatic full refund. If the resident cancels more than 2 h before the slot, full refund; later, no refund. *(These numbers are yours to set.)* |
| ⚑3 | **Slots.** | The doctor sets weekly hours plus exceptions (leave, extra hours). Slots are 15 min by default (per doctor: 10 / 15 / 20 / 30). The server generates slots from the hours, and a booked slot is locked atomically, so two people can't book it. Times are Asia/Kolkata. |
| ⚑4 | **"Describe your symptoms → suggested specialty".** | A **keyword map** maintained in code (en/te/hi words → specialty), with General Physician as the fallback. No AI, so no health text leaves our servers and no paid service is added. It only suggests; the resident picks. (An LLM-based suggester could come later, and would need its own consent and approval.) |
| ⚑5 | **Which records the doctor sees.** | At booking the resident ticks what to share (vitals, conditions & allergies, medicines, lab reports later). This uses the existing **`doctor_share`** consent, scoped to the appointment. The doctor sees it only from 15 min before the slot to 24 h after. Every view is logged in `record_shares`. Withdrawing it before the call removes access. |
| ⚑6 | **E-prescription format (Telemedicine Practice Guidelines 2020).** | A structured prescription: doctor name, qualification, **registration number** and council, clinic address, patient name / age / sex, date, chief complaints, diagnosis / provisional diagnosis, medicines (name, strength, dose, frequency, duration, instructions), investigations, advice, follow-up. It's rendered as a PDF in Records, signed with the doctor's uploaded signature image and the issue timestamp. The **TPG drug lists** are enforced in code: List O always; List A only on video and as a first-consult rule; List B only as follow-up of an in-person diagnosis; prohibited drugs (Schedule X / NDPS) are blocked. **⚑ A lawyer should review the format and lists before the pilot.** |
| ⚑7 | **In-clinic consults.** | Booking and payment only: address, map link and a reminder. No call. The doctor still writes the prescription in the portal after the visit. |
| ⚑8 | **Where calls run.** | **LiveKit Cloud** (in the decided stack); the API only issues short-lived room tokens to the two parties. For local development and CI, the **open-source LiveKit server in Docker** (free). **⚑ To check before signing up:** whether LiveKit Cloud can route media through an India region; media is never recorded or stored either way. |
| ⚑9 | **Ringing with the app closed (VoIP push).** | Android: `react-native-callkeep` (ConnectionService) + high-priority FCM data messages. iOS: CallKit + PushKit VoIP push; every push reports a call to CallKit at once (Apple's rule). Wired through Expo config plugins in the dev builds. **Android first**; iOS needs a Mac or EAS build and an Apple VoIP certificate. Versions are checked against current docs when I build. |
| ⚑10 | **Which calls this phase builds.** | Video and audio consults (resident ↔ doctor), **the SOS crew call in-app** (resident / family ↔ crew, replacing work-number-first; the work number stays as the fallback), and the desk call (console ↔ resident). Service calls (phlebotomist, companion, rider) use the same module in Phase 5. |
| ⚑11 | **When a call can't connect.** | After 2 failed attempts or when the other side is offline, a WhatsApp nudge: "Your doctor is waiting. Open the app to join" (template, no health details). For crew, desk and partner staff, also a one-tap phone call to their **company work number**. Residents' personal numbers are never shown to staff. |
| ⚑12 | **Recording.** | **Off.** No recording code at all in this phase (the brief: only later, with both sides' consent and storage in India). |
| ⚑13 | **Paid services this phase turns on**, all in the decided stack: **LiveKit Cloud** (per-minute), **Razorpay** (per-transaction), FCM / APNs (free). | Approve the accounts. Test keys and the local LiveKit server until launch. **Outside the code:** Razorpay KYC / merchant account (business name: see the rename checklist), Apple VoIP push certificate, WhatsApp templates `consult_*`. |

---

## 2. Data model (migrations, with RLS)

From the brief's outline; every table has `id`, `created_at`, `updated_at`, and medical rows are soft-deleted.

- **`specialties`**: code, names (en/te/hi), keywords (for ⚑4), active.
- **`doctors`**: user_id, name, qualification, registration_no, council, verified_at / verified_by, fee_paise (video / audio / clinic), slot_minutes, languages, clinic address and location, signature (private Storage file), active. Plus `doctor_specialties`.
- **`doctor_hours`**: weekday, start, end, consult types; **`doctor_exceptions`**: date range, off / extra hours.
- **`appointments`**: resident (user_id), booked_by (a family manager can book), doctor, specialty, type (`video` | `audio` | `clinic`), starts_at / ends_at, state, symptoms text (**encrypted**), shared items (from ⚑5), payment_id, room_name (opaque, expiring). Unique (doctor, starts_at) for active states.
- **`appointment_events`**: the timeline, as for SOS.
- **`consult_notes`**: doctor-only notes (**encrypted**).
- **`prescriptions`** + **`prescription_items`** (⚑6), pdf_path (private Storage), issued_at; revisions are new rows with a link to the one they replace.
- **`calls`**: type (`video_consult` | `audio_consult` | `crew` | `desk` | `service`), context (appointment / SOS / booking id), parties (user ids + roles), room_name, started_at, ended_at, end_reason, quality summary (bitrate, packet loss, reconnects). **Metadata only, never media.**
- **`push_tokens`**: user, device, platform, FCM token, VoIP token (iOS), app (`resident` | `field`), updated_at.
- **`payments`**: provider ids (Razorpay order / payment / refund), amount_paise, status, purpose (`consult`), plus a `webhook_events` table for idempotency.

**Appointment states:** `held` (slot held while paying, 10 min) → `booked` → `in_waiting_room` → `in_call` → `completed`; plus `cancelled_by_resident`, `cancelled_by_doctor`, `no_show_doctor`, `no_show_resident`, `expired_hold`. The edges are checked in `contracts`, as for SOS.

---

## 3. API (route modules `consults`, `calls`, `payments`, `partners`)

- **Resident:**
  - `GET /specialties`
  - `POST /consults/suggest` (symptoms → specialties, ⚑4; the text is not stored)
  - `GET /doctors?specialty&type&date`
  - `GET /doctors/{id}/slots?from&to`
  - `POST /appointments` (holds the slot, creates the Razorpay order)
  - `POST /appointments/{id}/cancel`
  - `GET /appointments`, `GET /appointments/{id}`
  - `PUT /appointments/{id}/sharing` (⚑5)
  - `GET /prescriptions`, `GET /prescriptions/{id}/pdf` (short-lived signed URL)
- **Payments:** `POST /webhooks/razorpay` (signature-verified, idempotent: `payment.captured` → `booked`, refunds). A hold that isn't paid expires through a **Workflow** (10 min durable sleep).
- **Doctor (partner portal):**
  - hours / exceptions CRUD
  - `GET /partner/consults?date` (queue)
  - `GET /partner/consults/{id}` (shared records in the consent window, logged)
  - notes
  - `POST /partner/consults/{id}/prescription` (validated against ⚑6)
  - `POST /partner/consults/{id}/complete`, `.../no-show`
- **Calls:**
  - `POST /calls` (context + callee) → room + **token for the caller only**, and a VoIP push to the callee
  - `POST /calls/{id}/token` (callee joins)
  - `POST /calls/{id}/end`
  - `POST /calls/{id}/quality`
  - `POST /calls/{id}/nudge` (⚑11)
  - Tokens last 2 min to join; a room expires when the call ends or after the slot + 30 min. Only the two parties of that appointment / SOS / booking can get a token. Everything is checked server-side.
- **Push:** `PUT /me/push-tokens`.
- **Console (operations):**
  - doctors CRUD + verify
  - specialties
  - the consultations list (no notes or prescriptions unless the role allows it)
  - refunds
- **Reminders (Workflows):**
  - WhatsApp confirmation at booking
  - a reminder 1 h before
  - "Doctor is waiting" when the doctor joins and the resident hasn't
  - "Prescription ready" when issued (all templates, no health details)

---

## 4. Calling rules (brief › In-app calling)

- **Pre-call:** device check for camera, mic and network.
- **During:** reconnects automatically; drops to audio-only when bandwidth is low (LiveKit adaptive stream + a manual "audio only" button).
- **Incoming call:** native ringing screen on Android (ConnectionService) and iOS (CallKit), also with the app killed.
- **Doctors** join from a desktop browser (LiveKit web SDK) in the partner portal, with the shared records and the prescription form beside the video.
- **Logging:** call metadata (who, when, how long, quality) is logged for support. Media never is.
- **Failure paths, all tested:**
  - the callee is offline → nudge
  - two failed attempts → nudge + work number (staff only)
  - the token is refused for someone who isn't a party
  - the network drops mid-call → reconnect
  - the room has expired

---

## 5. Screens (from the design files)

- **Resident app:**
  - Consult tab: video / audio / clinic; symptom box → suggested specialties; specialty chips; doctors with fee, languages, next slots; slot picker; "what to share" ticks; pay (Razorpay checkout); booking confirmed
  - Waiting room with device check
  - Call screen
  - E-prescription in Records (PDF)
  - Bookings list with join / cancel
  - Incoming-call screen (native)
  - SOS screen: **"Call crew" becomes in-app voice**, with the work number as the fallback
- **Field app:** incoming call from the resident, and crew → resident call from the job screen (in-app, with a WhatsApp nudge if unanswered).
- **Partner portal (doctor):**
  - schedule (hours, exceptions)
  - today's queue (waiting / in call / done)
  - consult view: video + shared records + notes + e-prescription form
  - prescription preview and issue
- **Console:**
  - doctors (onboard, verify, deactivate)
  - specialties
  - consultations list
  - payments and refunds
  - "Call resident" from the command center (desk call)

---

## 6. Tests

- **Unit:**
  - slot generation (hours, exceptions, time zone, DST-free IST)
  - appointment state machine
  - TPG drug-list rules (⚑6)
  - symptom → specialty map
  - refund rules (⚑2)
  - token issuance only to parties
  - Razorpay signature verification and idempotency
- **API integration:**
  - booking race (two residents, one slot → one wins)
  - hold expiry (Workflow)
  - webhook replay
  - consent window for shared records, and its logging
  - the doctor can't see unshared items
- **Calls:** against the **local LiveKit server**: two bots join with issued tokens; a non-party is refused; a room ends on hang-up.
- **Playwright:**
  - doctor portal: queue → consult → prescription → issued
  - console: doctor onboarding
  - axe on every new page
- **Maestro (Android emulator):** book → pay (Razorpay test mode) → waiting room → call; incoming call ringing with the app in the background.
- **Device pass:** a real Android phone, and an iPhone through EAS / Mac (CallKit and PushKit can only be tested on a real iPhone).

---

## 7. Order of work once approved

1. Migrations: doctors, specialties, hours, appointments, prescriptions, calls, push tokens, payments, plus the state machine and slot generator (unit-tested).
2. Console: doctor onboarding and specialties. Partner portal: schedule.
3. Booking API + Razorpay test mode + webhook + hold-expiry Workflow + reminders.
4. `calls` module: LiveKit token API against the local LiveKit server; doctor portal video (web SDK) with shared records.
5. E-prescription: form, TPG validation, PDF, Records.
6. Resident app: consult flow, waiting room, call screen, prescriptions. Android: dev build with LiveKit RN SDK + callkeep + FCM VoIP-style push.
7. In-app crew call (SOS) and desk call on the same module; WhatsApp nudge and work-number fallback.
8. iOS: CallKit / PushKit (EAS build), a real-iPhone pass.
9. Load and failure tests, e2e, docs, progress.
