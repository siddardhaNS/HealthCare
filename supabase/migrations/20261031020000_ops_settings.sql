-- Plan §11: platform-wide settings the super admin changes in the console.
-- One row. desk_phone is the community desk number residents call when the
-- app cannot reach our servers (no-network SOS fallback); null until set.
create table public.ops_settings (
  id boolean primary key default true check (id),
  updated_at timestamptz not null default now(),
  desk_phone text check (desk_phone ~ '^\+91\d{10}$'),
  updated_by uuid
);
insert into public.ops_settings (id) values (true);
create trigger ops_settings_updated_at before update on public.ops_settings for each row execute function public.set_updated_at();
-- Read and written only through the API (service connection); no client access.
alter table public.ops_settings enable row level security;
