-- Personal health record. Rows belong to a person (user_id). Readable and
-- writable by the person and their managers (can_act_for); staff and
-- partners only through the API after a consent check. Medical rows are
-- soft-deleted (deleted_at) and every insert/update is written to
-- audit_events by trigger (ids only, never values).
--
-- user_id uses ON DELETE RESTRICT: medical data is removed only by the
-- erasure process, which applies the retention rules.

create table public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null unique references auth.users (id) on delete restrict,
  entered_by uuid not null,
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  height_cm numeric(5, 1) check (height_cm between 50 and 250),
  date_of_birth date check (date_of_birth > '1900-01-01'),
  sex text check (sex in ('female', 'male', 'other'))
);

create table public.vital_readings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  type text not null check (type in ('bp', 'pulse', 'spo2', 'sugar', 'temp', 'weight')),
  -- bp: value = systolic, value2 = diastolic; every other type uses value only.
  value numeric(6, 1) not null,
  value2 numeric(6, 1),
  unit text not null,
  context text check (context in ('fasting', 'post_meal', 'random')),
  source text not null check (source in ('manual', 'device', 'health_connect', 'healthkit', 'care_team')),
  taken_at timestamptz not null,
  -- Physiological limits (same as the log-reading sheet).
  check (
    case type
      when 'bp' then value between 60 and 250 and value2 is not null and value2 between 30 and 150 and unit = 'mmHg'
      when 'pulse' then value between 30 and 220 and value2 is null and unit = 'bpm'
      when 'spo2' then value between 50 and 100 and value2 is null and unit = '%'
      when 'sugar' then value between 20 and 600 and value2 is null and unit = 'mg/dL'
      when 'temp' then value between 90 and 110 and value2 is null and unit = '°F'
      when 'weight' then value between 20 and 250 and value2 is null and unit = 'kg'
    end
  )
);
create index vital_readings_user_type_idx on public.vital_readings (user_id, type, taken_at desc) where deleted_at is null;

create table public.conditions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  name text not null,
  -- SNOMED CT code when known (ABDM / FHIR readiness).
  code text,
  status text not null check (status in ('controlled', 'monitoring', 'active', 'resolved')),
  diagnosed_on date,
  -- Free text is encrypted by the API before storage.
  notes_enc text
);

create table public.allergies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  substance text not null,
  code text,
  severity text not null check (severity in ('mild', 'moderate', 'severe')),
  reaction text
);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  name text not null,
  code text,
  strength text,
  dose text,
  frequency text,
  -- Local times of day doses are due, e.g. ["08:00", "21:00"].
  schedule jsonb not null default '[]'::jsonb,
  start_date date,
  end_date date,
  active boolean not null default true,
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.medication_doses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  medication_id uuid not null references public.medications (id) on delete restrict,
  scheduled_at timestamptz not null,
  status text not null check (status in ('taken', 'missed', 'skipped')),
  taken_at timestamptz,
  unique (medication_id, scheduled_at)
);
create index medication_doses_user_idx on public.medication_doses (user_id, scheduled_at desc);

create table public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  name text not null,
  dose_label text,
  given_on date,
  next_due date
);

create table public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  insurer text not null,
  -- Policy and member numbers are encrypted by the API before storage.
  policy_number_enc text,
  member_id_enc text,
  valid_until date,
  -- Path of the e-card image in the private storage bucket.
  card_path text
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references auth.users (id) on delete restrict,
  entered_by uuid not null,
  kind text not null check (kind in ('bp_monitor', 'glucometer', 'oximeter', 'scale', 'thermometer', 'phone')),
  name text not null,
  connection text not null check (connection in ('manual', 'bluetooth', 'health_connect', 'healthkit')),
  last_sync_at timestamptz
);

-- Writes to medical data land in audit_events (ids only, never values).
create or replace function public.audit_health_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    coalesce((select auth.jwt() ->> 'role'), 'service'),
    case
      when tg_op = 'INSERT' then 'create'
      when new.deleted_at is not null and old.deleted_at is null then 'delete'
      else 'update'
    end,
    tg_table_name,
    new.id,
    jsonb_build_object('subject_id', new.user_id)
  );
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'health_profiles', 'vital_readings', 'conditions', 'allergies', 'medications',
    'medication_doses', 'vaccinations', 'insurance_policies', 'devices'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.audit_health_write()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_act_for(user_id))', 'read own or managed', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_act_for(user_id) and entered_by = (select auth.uid()))', 'write own or managed', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_act_for(user_id)) with check (public.can_act_for(user_id))', 'update own or managed', t);
    -- No delete policy: rows are soft-deleted by setting deleted_at. The read
    -- policy does not hide deleted rows (Postgres would then reject the
    -- soft-delete update); readers filter deleted_at is null.
  end loop;
end $$;
