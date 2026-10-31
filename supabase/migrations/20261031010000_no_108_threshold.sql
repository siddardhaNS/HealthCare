-- Plan §11: no 108 step, so new incidents no longer copy a 108 threshold.
-- The column stays for past incidents.
alter table public.sos_incidents alter column escalate_after_s drop not null;
comment on column public.sos_incidents.escalate_after_s is 'Unused since plan §11 (no 108 step); kept for past incidents.';
