-- Phase 3 step 5: who may listen to an incident's live channel `sos:{incidentId}`.
-- The API publishes (secret key, bypasses RLS); apps only receive.
-- https://supabase.com/docs/guides/realtime/authorization (checked 2026-10-28).
-- RLS is already on for realtime.messages (enabling it again fails with 42501).
--
-- The subquery runs as the listener, so the existing sos_incidents policy
-- ("people read their own incidents": the person and their family managers)
-- decides. The console's desk and crew channels come with step 6.
-- Policies are cached per connection; payloads carry no medical details.

create policy "people receive their own incident's live updates" on realtime.messages
  for select to authenticated using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'sos:%'
    and exists (
      select 1 from public.sos_incidents i
      where i.id::text = substring((select realtime.topic()) from 5)
    )
  );
