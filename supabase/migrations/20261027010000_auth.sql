-- Auth: roles in the JWT, OTP audit trail, outbound message log and
-- messaging opt-ins. See docs/plans/auth.md.

create type public.app_role as enum (
  'super_admin', 'operations', 'community_desk', 'support',
  'doctor', 'pharmacy', 'lab', 'hospital',
  'crew', 'phlebotomist', 'companion', 'rider'
);

-- Residents have no row. scope_* narrows a role to one site/organisation/partner
-- (e.g. a community desk sees only its community).
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  scope_type text check (scope_type in ('site', 'organisation', 'partner')),
  scope_id uuid,
  check ((scope_type is null) = (scope_id is null)),
  unique nulls not distinct (user_id, role, scope_type, scope_id)
);
create index user_roles_user_idx on public.user_roles (user_id);
create trigger user_roles_updated_at before update on public.user_roles
  for each row execute function public.set_updated_at();

alter table public.user_roles enable row level security;
create policy "users read their own roles" on public.user_roles
  for select to authenticated using ((select auth.uid()) = user_id);

-- Adds app_roles to every access token. Runs inside Supabase Auth.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  roles jsonb;
begin
  select coalesce(jsonb_agg(distinct ur.role), '[]'::jsonb)
    into roles
    from public.user_roles ur
   where ur.user_id = (event ->> 'user_id')::uuid;

  claims := jsonb_set(coalesce(event -> 'claims', '{}'::jsonb), '{app_roles}', roles);
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on table public.user_roles to supabase_auth_admin;
create policy "auth admin reads roles" on public.user_roles
  for select to supabase_auth_admin using (true);

-- One row per OTP send request, for abuse monitoring. Never the code; the
-- phone is stored as a keyed hash.
create table public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  phone_hash text not null,
  channel text not null check (channel in ('whatsapp', 'sms')),
  outcome text not null check (outcome in ('sent', 'fallback_sms', 'rate_limited', 'failed'))
);
create index otp_challenges_phone_idx on public.otp_challenges (phone_hash, created_at desc);
alter table public.otp_challenges enable row level security;

-- Every outbound WhatsApp/SMS message and its delivery status. Never message
-- bodies or variables (they can carry codes); template name + version only.
create table public.message_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp', 'sms')),
  category text not null check (category in ('authentication', 'utility', 'marketing')),
  template text not null,
  template_version integer not null,
  language text not null,
  to_phone text not null,
  user_id uuid references auth.users (id) on delete set null,
  purpose text not null,
  provider_message_id text unique,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  fallback_of uuid references public.message_log (id)
);
create index message_log_phone_idx on public.message_log (to_phone, created_at desc);
create index message_log_spend_idx on public.message_log (channel, category, created_at);
create trigger message_log_updated_at before update on public.message_log
  for each row execute function public.set_updated_at();
alter table public.message_log enable row level security;

-- Append-only history of messaging consent; the latest row per
-- (phone, channel) is the current state. STOP replies add an opted_out row.
create table public.messaging_optins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  phone text not null,
  channel text not null check (channel in ('whatsapp', 'sms')),
  status text not null check (status in ('opted_in', 'opted_out')),
  source text not null check (source in ('signin', 'profile', 'stop_reply', 'console')),
  consent_version text
);
create index messaging_optins_current_idx on public.messaging_optins (phone, channel, created_at desc);
alter table public.messaging_optins enable row level security;
create trigger messaging_optins_no_update
  before update or delete on public.messaging_optins
  for each row execute function public.append_only_guard();
