-- Hospital handover (docs/plans/phase-3-sos.md §3.7, §10).

-- The person's preferred receiving hospital (⚑4), set by them or a family manager through the API.
alter table public.profiles
  add column preferred_hospital_id uuid references public.hospitals (id) on delete set null;

alter table public.hospitals
  add column address text,
  add column city text;

alter table public.hospital_handovers
  add column updated_at timestamptz not null default now(),
  -- How the hospital was picked: automatically on accept, or changed by the crew or desk (with a reason).
  add column chosen_by text not null default 'auto' check (chosen_by in ('auto', 'crew', 'desk')),
  add column choice_reason text,
  add column preferred boolean not null default false;
create index hospital_handovers_hospital_idx on public.hospital_handovers (hospital_id, created_at desc);
create trigger hospital_handovers_updated_at before update on public.hospital_handovers
  for each row execute function public.set_updated_at();

-- Read and written by the API only (service role); RLS is already on with no policies.
