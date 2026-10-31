-- Plan §13: messages sent about something (an SOS) carry what they were about,
-- so the 60 s SMS fallback can find the alerts that were not delivered.
alter table public.message_log
  add column context_type text,
  add column context_id uuid;
create index message_log_context_idx on public.message_log (context_type, context_id) where context_id is not null;
