-- Plan §11: a primary team and an ordered list of backup teams per place.
-- rank 0 = primary, 1.. = backup 1, backup 2, … (tried in that order).
alter table public.coverage_assignments
  add column rank smallint not null default 0 check (rank between 0 and 9);
alter table public.coverage_assignments
  drop constraint coverage_assignments_site_id_key,
  drop constraint coverage_assignments_household_id_key;
-- One team per rank per place, and a team at most once per place.
create unique index coverage_assignments_site_rank_idx on public.coverage_assignments (site_id, rank) where site_id is not null;
create unique index coverage_assignments_household_rank_idx on public.coverage_assignments (household_id, rank) where household_id is not null;
create unique index coverage_assignments_site_team_idx on public.coverage_assignments (site_id, team_id) where site_id is not null;
create unique index coverage_assignments_household_team_idx on public.coverage_assignments (household_id, team_id) where household_id is not null;

-- 108 is no longer part of the SOS flow (plan §11). The state stays valid for
-- past incidents; new ones never enter it (the state machine has no edge to it).
comment on column public.site_sos_settings.escalate_after_s is 'Unused since plan §11 (no 108 step); kept for history.';
