-- Customers and households. A household may exist without a community
-- (home_id null): families sign up directly.

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null check (type in ('community', 'senior_home', 'employer')),
  name text not null,
  city text not null
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  name text not null,
  kind text not null check (kind in ('gated', 'apartment', 'township', 'senior_home', 'office')),
  address text,
  city text not null,
  pin text check (pin ~ '^\d{6}$'),
  boundary extensions.geography(polygon, 4326),
  -- Residents join a site with this code (shared by the association).
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{6,10}$'),
  desk_phone text
);
create index sites_boundary_idx on public.sites using gist (boundary);

create table public.homes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  site_id uuid not null references public.sites (id) on delete restrict,
  kind text not null check (kind in ('villa', 'flat')),
  tower text,
  floor integer,
  number text not null,
  location extensions.geography(point, 4326),
  unique nulls not distinct (site_id, tower, number)
);
create index homes_location_idx on public.homes using gist (location);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  home_id uuid references public.homes (id) on delete set null,
  name text,
  -- Address fields for households without a home in a site.
  address text,
  city text,
  pin text check (pin ~ '^\d{6}$'),
  location extensions.geography(point, 4326)
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  relation text,
  unique (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  relation text,
  phone text not null check (phone ~ '^\+91[6-9]\d{9}$'),
  priority smallint not null default 1
);
create index emergency_contacts_user_idx on public.emergency_contacts (user_id);

do $$
declare t text;
begin
  foreach t in array array['organisations', 'sites', 'homes', 'households', 'household_members', 'emergency_contacts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create or replace function public.is_household_member(h uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
     where m.household_id = h and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_household_member(uuid) from anon;

-- Reads for members; membership and community changes go through the API
-- (join codes are verified there), so there are no client write policies.
create policy "members read their household" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "members read household membership" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));
create policy "members read their home" on public.homes
  for select to authenticated using (
    exists (select 1 from public.households h where h.home_id = homes.id and public.is_household_member(h.id))
  );
create policy "members read their site" on public.sites
  for select to authenticated using (
    exists (
      select 1 from public.homes hm join public.households h on h.home_id = hm.id
       where hm.site_id = sites.id and public.is_household_member(h.id)
    )
  );

create policy "people and managers manage emergency contacts" on public.emergency_contacts
  for all to authenticated using (public.can_act_for(user_id)) with check (public.can_act_for(user_id));
