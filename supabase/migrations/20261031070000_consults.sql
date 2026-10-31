-- Phase 4: consults, calls, payments. See docs/plans/phase-4-consults-calling.md.
-- The API (service connection) writes everything; residents and their managers
-- read their own appointments, prescriptions and calls. States and transitions are
-- enforced by the API (@repo/contracts/consults); the checks below are a backstop.

create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique check (code ~ '^[a-z_]{2,40}$'),
  -- { en, te, hi }
  names jsonb not null,
  -- Words that suggest this specialty from a symptom text (⚑4), per language.
  keywords jsonb not null default '{}',
  active boolean not null default true
);

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users (id) on delete restrict,
  full_name text not null,
  qualification text not null,
  -- Medical council registration (⚑1): checked by operations before activation.
  registration_no text not null,
  council text not null,
  verified_at timestamptz,
  verified_by uuid,
  fee_video_paise integer check (fee_video_paise >= 0),
  fee_audio_paise integer check (fee_audio_paise >= 0),
  fee_clinic_paise integer check (fee_clinic_paise >= 0),
  slot_minutes smallint not null default 15 check (slot_minutes in (10, 15, 20, 30)),
  languages text[] not null default '{en}',
  clinic_address text,
  clinic_location extensions.geography(point, 4326),
  -- Private Storage path of the signature image used on e-prescriptions.
  signature_path text,
  active boolean not null default false,
  unique (council, registration_no)
);

create table public.doctor_specialties (
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  specialty_id uuid not null references public.specialties (id) on delete restrict,
  primary key (doctor_id, specialty_id)
);

create table public.doctor_hours (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  types text[] not null check (types <@ array['video', 'audio', 'clinic']::text[] and cardinality(types) > 0)
);

create table public.doctor_exceptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  kind text not null check (kind in ('off', 'extra')),
  start_time time,
  end_time time,
  types text[],
  check (kind = 'off' or (start_time is not null and end_time > start_time))
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The patient; a family manager may book for them (booked_by).
  user_id uuid not null references auth.users (id) on delete restrict,
  booked_by uuid not null references auth.users (id) on delete restrict,
  doctor_id uuid not null references public.doctors (id) on delete restrict,
  specialty_id uuid references public.specialties (id) on delete set null,
  type text not null check (type in ('video', 'audio', 'clinic')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  state text not null check (state in ('held', 'booked', 'in_waiting_room', 'in_call', 'completed', 'cancelled_by_resident', 'cancelled_by_doctor', 'no_show_doctor', 'no_show_resident', 'expired_hold')),
  hold_expires_at timestamptz,
  fee_paise integer not null check (fee_paise >= 0),
  -- Encrypted at rest (field key), like other free-text health notes.
  symptoms_enc text,
  -- ⚑5: what the resident chose to share for this consult.
  shared_items text[] not null default '{}',
  room_name text unique,
  deleted_at timestamptz
);
-- One live appointment per doctor and start time (a slot is booked once).
create unique index appointments_slot_idx on public.appointments (doctor_id, starts_at)
  where state in ('held', 'booked', 'in_waiting_room', 'in_call', 'completed') and deleted_at is null;
create index appointments_user_idx on public.appointments (user_id, starts_at desc);

create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_id uuid,
  actor_role text not null,
  reason text
);

create table public.consult_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete restrict,
  notes_enc text not null,
  deleted_at timestamptz
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  doctor_id uuid not null references public.doctors (id) on delete restrict,
  chief_complaints text,
  diagnosis text,
  investigations text,
  advice text,
  follow_up text,
  pdf_path text,
  issued_at timestamptz,
  -- A correction is a new prescription that replaces this one.
  replaces_id uuid references public.prescriptions (id) on delete set null,
  deleted_at timestamptz
);

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  position smallint not null,
  name text not null,
  strength text,
  dose text,
  frequency text,
  duration text,
  instructions text,
  -- Telemedicine Practice Guidelines list the drug falls under (⚑6): 'O', 'A' or 'B'.
  tpg_list text check (tpg_list in ('O', 'A', 'B'))
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null check (type in ('video_consult', 'audio_consult', 'crew', 'desk', 'service')),
  context_type text not null check (context_type in ('appointment', 'sos', 'booking')),
  context_id uuid not null,
  caller_id uuid not null,
  caller_role text not null,
  callee_id uuid not null,
  callee_role text not null,
  room_name text not null unique,
  state text not null default 'ringing' check (state in ('ringing', 'connected', 'ended', 'missed', 'failed')),
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  -- Metadata only, never media (no recording, ⚑12).
  quality jsonb
);
create index calls_context_idx on public.calls (context_type, context_id);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null check (app in ('resident', 'field')),
  platform text not null check (platform in ('android', 'ios')),
  device_id text not null,
  fcm_token text,
  voip_token text,
  unique (user_id, app, device_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete restrict,
  purpose text not null check (purpose in ('consult')),
  context_id uuid not null,
  amount_paise integer not null check (amount_paise >= 0),
  currency text not null default 'INR',
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text unique,
  status text not null check (status in ('created', 'captured', 'failed', 'refund_pending', 'refunded')),
  refund_id text,
  refunded_paise integer not null default 0
);

-- Each provider webhook event is applied once.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  unique (provider, event_id)
);

do $$
declare t text;
begin
  foreach t in array array['specialties', 'doctors', 'doctor_hours', 'doctor_exceptions', 'appointments', 'consult_notes', 'prescriptions', 'calls', 'push_tokens', 'payments'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['specialties', 'doctors', 'doctor_specialties', 'doctor_hours', 'doctor_exceptions', 'appointments', 'appointment_events', 'consult_notes', 'prescriptions', 'prescription_items', 'calls', 'push_tokens', 'payments', 'webhook_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Anyone signed in may read the specialty list.
create policy "signed-in people read specialties" on public.specialties for select to authenticated using (active);
-- Residents (and their managers) read their own appointments and prescriptions.
create policy "people read their own appointments" on public.appointments
  for select to authenticated using (public.can_act_for(user_id) and deleted_at is null);
create policy "people read their own prescriptions" on public.prescriptions
  for select to authenticated using (public.can_act_for(user_id) and deleted_at is null and issued_at is not null);
create policy "people read their prescription items" on public.prescription_items
  for select to authenticated using (
    exists (select 1 from public.prescriptions p where p.id = prescription_items.prescription_id and public.can_act_for(p.user_id) and p.issued_at is not null and p.deleted_at is null)
  );
