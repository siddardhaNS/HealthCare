-- Languages the apps offer (2026-10-31). English is always on; the others
-- appear only once the super admin enables them in the console.
alter table public.ops_settings
  add column languages text[] not null default '{en}'
  check ('en' = any (languages) and languages <@ array['en', 'te', 'hi']::text[]);
