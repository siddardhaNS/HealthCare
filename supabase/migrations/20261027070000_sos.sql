-- Phase 3: SOS and dispatch. See docs/plans/phase-3-sos.md.
-- The API (service role) writes everything; residents and their managers
-- read their own incidents and timeline. States and transitions are
-- enforced by the API (@repo/contracts/sos); the check below is a backstop.

create table public.standby_points (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site_id uuid references public.sites (id) on delete set null,
  name text not null,
  location extensions.geography(point, 4326) not null
);

create table public.ambulances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  registration text not null unique,
  operator text not null,
  operator_kind text not null check (operator_kind in ('own', 'partner')),
  equipment text not null check (equipment in ('bls', 'als')),
  -- Company-issued number the crew answers; never a personal number.
  work_phone text not null check (work_phone ~ '^\+91[6-9]\d{9}$'),
  active boolean not null default true
);

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users (id) on delete restrict,
  ambulance_id uuid references public.ambulances (id) on delete set null,
  -- Takes part in drills (test SOS is offered only to these crews).
  drill_participant boolean not null default false,
  active boolean not null default true
);

create table public.crew_shifts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  standby_point_id uuid references public.standby_points (id) on delete set null,
  check (ended_at is null or ended_at > started_at)
);
create unique index crew_shifts_open_idx on public.crew_shifts (crew_id) where ended_at is null;

create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  location extensions.geography(point, 4326) not null,
  er_phone text not null,
  has_capacity boolean not null default true,
  capacity_updated_at timestamptz,
  active boolean not null default true
);
create index hospitals_location_idx on public.hospitals using gist (location);

-- Per-site escalation thresholds (plan ⚑2): defaults 30 / 90 s.
create table public.site_sos_settings (
  site_id uuid primary key references public.sites (id) on delete cascade,
  updated_at timestamptz not null default now(),
  widen_after_s integer not null default 30 check (widen_after_s between 15 and 60),
  escalate_after_s integer not null default 90 check (escalate_after_s between 60 and 180),
  gate_phone text check (gate_phone ~ '^\+91[6-9]\d{9}$'),
  updated_by uuid,
  check (escalate_after_s > widen_after_s)
);

create table public.sos_incidents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete restrict,
  household_id uuid references public.households (id) on delete set null,
  site_id uuid references public.sites (id) on delete set null,
  -- The person or manager who raised it (the desk can raise on a resident's behalf).
  raised_by uuid not null,
  idempotency_key uuid not null,
  location extensions.geography(point, 4326),
  accuracy_m numeric(7, 1),
  state text not null default 'raised' check (state in (
    'raised', 'dispatching', 'accepted', 'en_route', 'on_scene', 'transporting',
    'handed_over', 'closed', 'cancelled', 'escalated_to_108'
  )),
  is_drill boolean not null default false,
  crew_id uuid references public.crews (id) on delete set null,
  ambulance_id uuid references public.ambulances (id) on delete set null,
  hospital_id uuid references public.hospitals (id) on delete set null,
  widen_after_s integer not null,
  escalate_after_s integer not null,
  workflow_run_id text,
  closed_at timestamptz,
  unique (raised_by, idempotency_key)
);
-- One open incident per person (a second press returns the first).
create unique index sos_incidents_one_open_idx on public.sos_incidents (user_id)
  where state not in ('closed', 'cancelled');
create index sos_incidents_site_idx on public.sos_incidents (site_id, created_at desc);

-- Every state change, timestamped (brief hard requirement). Append-only.
create table public.sos_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  incident_id uuid not null references public.sos_incidents (id) on delete restrict,
  from_state text,
  to_state text not null,
  actor_id uuid,
  actor_role text not null check (actor_role in ('resident', 'crew', 'desk', 'system')),
  reason text,
  metadata jsonb not null default '{}'::jsonb
);
create index sos_events_incident_idx on public.sos_events (incident_id, created_at);
create trigger sos_events_append_only
  before update or delete on public.sos_events
  for each row execute function public.append_only_guard();

create table public.dispatch_offers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  incident_id uuid not null references public.sos_incidents (id) on delete cascade,
  crew_id uuid not null references public.crews (id) on delete cascade,
  ring smallint not null,
  eta_s integer,
  response text check (response in ('accepted', 'declined', 'expired', 'released')),
  responded_at timestamptz,
  unique (incident_id, crew_id)
);

create table public.hospital_handovers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  incident_id uuid not null unique references public.sos_incidents (id) on delete restrict,
  hospital_id uuid not null references public.hospitals (id) on delete restrict,
  -- What was shared (consent: everything, or blood group only).
  items text[] not null,
  -- The handover link carries a random token; only its hash is stored.
  token_hash text not null unique,
  expires_at timestamptz not null,
  first_aid_notes_enc text,
  confirmed_at timestamptz,
  confirmed_by uuid
);

do $$
declare t text;
begin
  foreach t in array array['standby_points', 'ambulances', 'crews', 'hospitals', 'site_sos_settings', 'sos_incidents'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['standby_points', 'ambulances', 'crews', 'crew_shifts', 'hospitals', 'site_sos_settings', 'sos_incidents', 'sos_events', 'dispatch_offers', 'hospital_handovers'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Residents (and their managers) read their own incidents and timeline.
create policy "people read their own incidents" on public.sos_incidents
  for select to authenticated using (public.can_act_for(user_id));
create policy "people read their incident timeline" on public.sos_events
  for select to authenticated using (
    exists (select 1 from public.sos_incidents i where i.id = sos_events.incident_id and public.can_act_for(i.user_id))
  );
