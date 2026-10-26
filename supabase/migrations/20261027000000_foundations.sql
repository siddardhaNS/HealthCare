-- Foundations: extensions, shared helpers and the append-only audit log.
-- SQL migrations in supabase/migrations are the source of truth for DDL and
-- RLS; packages/db mirrors tables in Drizzle for typed queries.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Keeps updated_at current on every table that has it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Every write to medical data, every record share and every SOS action
-- lands here. Rows are never updated or deleted.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  household_id uuid,
  request_id text,
  -- Ids and field names only; never health values.
  metadata jsonb not null default '{}'::jsonb
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);
create index audit_events_household_idx on public.audit_events (household_id, created_at desc);

create or replace function public.append_only_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger audit_events_no_update
  before update or delete on public.audit_events
  for each row execute function public.append_only_guard();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.append_only_guard();

alter table public.audit_events enable row level security;
-- No policies yet: only the service role (the API) can read or insert.
revoke update, delete, truncate on public.audit_events from anon, authenticated;
