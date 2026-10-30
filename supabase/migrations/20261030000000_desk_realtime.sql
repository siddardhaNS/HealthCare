-- Phase 3 step 6: who may listen to the command center's channels.
--   desk:{siteId}  a community desk's own community (new SOS, alarms, state, positions)
--   desk:all       every incident, for super admin / operations / support
-- The API publishes (secret key, bypasses RLS); the console only receives.
-- https://supabase.com/docs/guides/realtime/authorization (checked 2026-10-30).
-- Staff need a TOTP-verified session (aal2), as on every console page.
-- The user_roles subquery runs as the listener ("users read their own roles").
-- Payloads carry ids, states and positions only, never medical details.

create policy "staff receive command center updates" on realtime.messages
  for select to authenticated using (
    realtime.messages.extension = 'broadcast'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and (
      (
        (select realtime.topic()) = 'desk:all'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid()) and ur.role in ('super_admin', 'operations', 'support')
        )
      )
      or (
        (select realtime.topic()) like 'desk:%'
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid())
            and ur.role = 'community_desk'
            and ur.scope_type = 'site'
            and ur.scope_id::text = substring((select realtime.topic()) from 6)
        )
      )
    )
  );
