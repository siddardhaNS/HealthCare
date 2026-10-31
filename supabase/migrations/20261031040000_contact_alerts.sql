-- Plan §13: SOS alerts go to emergency contacts who agreed to get them. The
-- resident confirms that agreement when adding the contact (WhatsApp needs a
-- recorded opt-in); it is kept here and as a messaging_optins row per channel.
alter table public.emergency_contacts
  add column alerts_agreed_at timestamptz,
  add column alerts_confirmed_by uuid;

alter table public.messaging_optins drop constraint messaging_optins_source_check;
alter table public.messaging_optins
  add constraint messaging_optins_source_check check (source in ('signin', 'profile', 'stop_reply', 'console', 'confirmed_by_resident'));
