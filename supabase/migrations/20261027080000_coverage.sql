-- Coverage teams (docs/plans/phase-3-sos.md §9): ops assign gated communities,
-- apartment buildings and stand-alone homes to one crew-and-ambulance team.
-- An SOS from a covered household is offered to that team first. One team
-- covers many places; each place has at most one team (enforced below).

create table public.coverage_teams (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  -- Free-text label shown in the console, e.g. 'Gachibowli'.
  area text,
  active boolean not null default true
);
create trigger coverage_teams_updated_at before update on public.coverage_teams
  for each row execute function public.set_updated_at();

-- A crew member and an ambulance belong to one team at a time.
alter table public.crews add column team_id uuid references public.coverage_teams (id) on delete set null;
alter table public.ambulances add column team_id uuid references public.coverage_teams (id) on delete set null;
create index crews_team_idx on public.crews (team_id);

create table public.coverage_assignments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  team_id uuid not null references public.coverage_teams (id) on delete cascade,
  -- Exactly one of: a site (households in it follow the site) or a
  -- stand-alone household (no home in a site; checked by the API).
  site_id uuid unique references public.sites (id) on delete cascade,
  household_id uuid unique references public.households (id) on delete cascade,
  assigned_by uuid,
  check ((site_id is null) <> (household_id is null))
);
create index coverage_assignments_team_idx on public.coverage_assignments (team_id);

-- Written and read by the API (service role) only; the console goes through it.
alter table public.coverage_teams enable row level security;
alter table public.coverage_assignments enable row level security;

-- Dispatch looks up pending offers per crew and per incident.
create index dispatch_offers_crew_pending_idx on public.dispatch_offers (crew_id) where response is null;
