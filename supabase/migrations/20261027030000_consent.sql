-- Consent: purpose-specific, append-only, versioned (DPDP). See
-- docs/plans/phase-2-households-consent.md. The current state of a consent
-- is the latest row per (user, purpose, scope_key).

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- No foreign key: consent records outlive account deletion as evidence.
  user_id uuid not null,
  purpose text not null check (purpose in (
    'care_record', 'emergency_share', 'family_sos_alert', 'doctor_share',
    'proactive_care', 'manager', 'whatsapp_updates', 'reminders'
  )),
  -- Distinguishes scoped consents: the manager's user id for 'manager', the
  -- booking id for 'doctor_share'; '' when the purpose has no scope.
  scope_key text not null default '',
  scope jsonb not null default '{}'::jsonb,
  status text not null check (status in ('granted', 'withdrawn')),
  notice_version text not null,
  language text not null check (language in ('en', 'te', 'hi')),
  -- Who performed the action: the person, or a manager for doctor_share.
  acted_by uuid not null
);
create index consents_current_idx on public.consents (user_id, purpose, scope_key, created_at desc);

create trigger consents_append_only
  before update or delete on public.consents
  for each row execute function public.append_only_guard();

-- Latest state per consent.
create view public.current_consents with (security_invoker = true) as
  select distinct on (user_id, purpose, scope_key)
    user_id, purpose, scope_key, scope, status, notice_version, created_at
  from public.consents
  order by user_id, purpose, scope_key, created_at desc;

create or replace function public.has_consent(subject uuid, p text, key text default '')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.status = 'granted'
      from public.consents c
     where c.user_id = subject and c.purpose = p and c.scope_key = key
     order by c.created_at desc
     limit 1
  ), false);
$$;

-- True for the person themselves, or a family member they made a manager.
create or replace function public.can_act_for(subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select subject = (select auth.uid())
      or public.has_consent(subject, 'manager', (select auth.uid())::text);
$$;

revoke execute on function public.has_consent(uuid, text, text) from anon;
revoke execute on function public.can_act_for(uuid) from anon;

alter table public.consents enable row level security;

create policy "people and their managers read consents" on public.consents
  for select to authenticated using (public.can_act_for(user_id));

-- Only the person grants or withdraws their own consents. A manager may
-- record per-booking doctor_share choices when booking on their behalf.
create policy "people record their own consents" on public.consents
  for insert to authenticated with check (
    acted_by = (select auth.uid())
    and (
      user_id = (select auth.uid())
      or (purpose = 'doctor_share' and public.can_act_for(user_id))
    )
  );

-- Every disclosure of health data to someone other than the person:
-- who saw what, when and why. Written by the API (service role).
create table public.record_shares (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject_id uuid not null,
  viewer_id uuid,
  viewer_role text not null,
  purpose text not null,
  items text[] not null,
  context_type text not null check (context_type in ('consult', 'sos', 'care_team', 'manager', 'export')),
  context_id uuid,
  expires_at timestamptz
);
create index record_shares_subject_idx on public.record_shares (subject_id, created_at desc);

create trigger record_shares_append_only
  before update or delete on public.record_shares
  for each row execute function public.append_only_guard();

alter table public.record_shares enable row level security;
create policy "people see who saw their records" on public.record_shares
  for select to authenticated using (public.can_act_for(subject_id));
