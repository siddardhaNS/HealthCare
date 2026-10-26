-- Landing-site sign-ups from communities, organisations and families.
-- Written and read only by the API (service role); no client access.

create type public.lead_status as enum ('new', 'contacted', 'walkthrough_booked', 'live');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ref text not null unique,
  status public.lead_status not null default 'new',
  org_type text not null check (org_type in ('gated', 'apartment', 'township', 'senior_home', 'employer', 'family')),
  org_name text,
  city text not null,
  area text,
  pin text check (pin ~ '^\d{6}$'),
  size integer not null check (size > 0),
  towers integer check (towers > 0),
  senior_share text not null default 'unknown',
  onsite text[] not null default '{}',
  contact_name text not null,
  contact_role text not null,
  phone text not null,
  email text not null,
  services text[] not null,
  plan text not null,
  walkthrough text not null,
  notes text,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  status_changed_by uuid references auth.users (id) on delete set null
);

create index leads_status_idx on public.leads (status, created_at desc);
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
alter table public.leads enable row level security;
