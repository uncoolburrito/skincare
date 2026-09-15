-- ==============================================================================
-- Skin Streak — Shared Two-Person Skincare Habit Tracker
-- Supabase Schema & Realtime Setup
-- ==============================================================================
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Create the shared tracker logs table
create table if not exists public.skin_streak_logs (
  id text primary key,
  entries jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{
    "friendName": "",
    "friendPhone": "",
    "amTime": "08:00",
    "pmTime": "22:00",
    "routineStartDate": ""
  }'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Enable Row Level Security (RLS)
alter table public.skin_streak_logs enable row level security;

-- 3. Policy: Allow anon reads and writes by unguessable tracker ID
-- This matches the obscurity-based access control specified for this personal 2-person tool.
drop policy if exists "Allow anon read access" on public.skin_streak_logs;
create policy "Allow anon read access"
  on public.skin_streak_logs
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Allow anon insert access" on public.skin_streak_logs;
create policy "Allow anon insert access"
  on public.skin_streak_logs
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow anon update access" on public.skin_streak_logs;
create policy "Allow anon update access"
  on public.skin_streak_logs
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- 4. Enable Realtime Replication
-- Allows subscribed browser clients to receive instant WebSocket push events on changes
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'skin_streak_logs'
  ) then
    alter publication supabase_realtime add table public.skin_streak_logs;
  end if;
end $$;

-- 5. Helper trigger to auto-update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_skin_streak_logs_updated_at on public.skin_streak_logs;
create trigger set_skin_streak_logs_updated_at
  before update on public.skin_streak_logs
  for each row
  execute function public.handle_updated_at();
