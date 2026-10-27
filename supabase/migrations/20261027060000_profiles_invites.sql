-- People's display details and family invitations.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null check (char_length(full_name) between 1 and 80),
  language text not null default 'en' check (language in ('en', 'te', 'hi'))
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- True when the caller and `other` belong to the same household.
create or replace function public.shares_household(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.household_members a
      join public.household_members b on a.household_id = b.household_id
     where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;
revoke execute on function public.shares_household(uuid) from anon;

alter table public.profiles enable row level security;
create policy "people read their own and household members' names" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()) or public.shares_household(user_id));
create policy "people edit their own profile" on public.profiles
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A household member invites a relative by phone. The invite is accepted
-- by whoever signs in with that (verified) phone number.
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  household_id uuid not null references public.households (id) on delete cascade,
  phone text not null check (phone ~ '^\+91[6-9]\d{9}$'),
  relation text,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create unique index household_invites_open_idx on public.household_invites (household_id, phone)
  where accepted_at is null and revoked_at is null;
create index household_invites_phone_idx on public.household_invites (phone) where accepted_at is null and revoked_at is null;

-- Managed through the API only.
alter table public.household_invites enable row level security;
