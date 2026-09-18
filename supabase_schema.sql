-- ==============================================================================
-- Skin Streak v3 — Schema & Row Level Security Setup
-- ==============================================================================
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/whekrgnecterjouoyxer/sql
--
-- Features:
-- 1. Four normalized tables: trackers, cycles, partner_invites, tracker_partners
-- 2. Strict Row Level Security: Owner has full read/write, Partner has read-only
-- 3. Guaranteed privacy: partner_phone is strictly never exposed to Partner clients
-- 4. Atomic single-use invite redemption via SECURITY DEFINER stored function
-- 5. Supabase Realtime replication on trackers and cycles
-- ==============================================================================

-- 1. Create Tables

-- Trackers table
create table if not exists public.trackers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade not null,
  partner_name text,
  partner_phone text,              -- Owner-only readable (never exposed to Partner)
  nudge_threshold_hours int default 14,
  last_nudged_cycle_id uuid,
  created_at timestamptz default now()
);

-- Cycles table (sleep-cycle events: After Sleep and Before Sleep)
create table if not exists public.cycles (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid references public.trackers(id) on delete cascade not null,
  after_sleep_at timestamptz,
  before_sleep_at timestamptz,
  adapalene boolean,               -- null until before_sleep_at is set
  created_at timestamptz default now()
);

-- Partner Invites table (single-use 7-day tokens)
create table if not exists public.partner_invites (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid references public.trackers(id) on delete cascade not null,
  token text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);

-- Tracker Partners link table
create table if not exists public.tracker_partners (
  tracker_id uuid references public.trackers(id) on delete cascade not null,
  partner_user_id uuid references auth.users(id) on delete cascade not null,
  joined_at timestamptz default now(),
  primary key (tracker_id, partner_user_id)
);

-- Helpful indexes
create index if not exists idx_cycles_tracker_id on public.cycles(tracker_id, created_at asc);
create index if not exists idx_invites_token on public.partner_invites(token);
create index if not exists idx_tracker_partners_user on public.tracker_partners(partner_user_id);
create index if not exists idx_trackers_owner on public.trackers(owner_id);

-- ==============================================================================
-- 2. Row Level Security (RLS)
-- ==============================================================================

alter table public.trackers enable row level security;
alter table public.cycles enable row level security;
alter table public.partner_invites enable row level security;
alter table public.tracker_partners enable row level security;

-- ------------------------------------------------------------------------------
-- RLS: trackers
-- Base table SELECT is restricted to owner only so partner_phone is never leaked.
-- Partners access tracker metadata through the secure trackers_view below.
-- ------------------------------------------------------------------------------
drop policy if exists "Trackers owner select" on public.trackers;
create policy "Trackers owner select"
  on public.trackers for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Trackers owner insert" on public.trackers;
create policy "Trackers owner insert"
  on public.trackers for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Trackers owner update" on public.trackers;
create policy "Trackers owner update"
  on public.trackers for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Trackers owner delete" on public.trackers;
create policy "Trackers owner delete"
  on public.trackers for delete to authenticated
  using (owner_id = auth.uid());

-- ------------------------------------------------------------------------------
-- Secure View: trackers_view
-- Both Owner and Partner query this view.
-- For the Owner: partner_phone is returned.
-- For the Partner: partner_phone is strictly NULL at the database level!
-- ------------------------------------------------------------------------------
create or replace view public.trackers_view with (security_invoker = false) as
select
  t.id,
  t.owner_id,
  t.partner_name,
  case
    when t.owner_id = auth.uid() then t.partner_phone
    else null
  end as partner_phone,
  t.nudge_threshold_hours,
  t.last_nudged_cycle_id,
  t.created_at,
  case
    when t.owner_id = auth.uid() then 'owner'
    else 'partner'
  end as user_role
from public.trackers t
where t.owner_id = auth.uid()
   or exists (
     select 1 from public.tracker_partners tp
     where tp.tracker_id = t.id and tp.partner_user_id = auth.uid()
   );

grant select on public.trackers_view to authenticated;

-- ------------------------------------------------------------------------------
-- RLS: cycles
-- SELECT: Allowed to Owner and linked Partners
-- INSERT/UPDATE/DELETE: Owner only
-- ------------------------------------------------------------------------------
drop policy if exists "Cycles select policy" on public.cycles;
create policy "Cycles select policy"
  on public.cycles for select to authenticated
  using (
    exists (
      select 1 from public.trackers t
      where t.id = cycles.tracker_id
        and (
          t.owner_id = auth.uid()
          or exists (
            select 1 from public.tracker_partners tp
            where tp.tracker_id = t.id and tp.partner_user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "Cycles insert policy" on public.cycles;
create policy "Cycles insert policy"
  on public.cycles for insert to authenticated
  with check (
    exists (
      select 1 from public.trackers t
      where t.id = tracker_id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "Cycles update policy" on public.cycles;
create policy "Cycles update policy"
  on public.cycles for update to authenticated
  using (
    exists (
      select 1 from public.trackers t
      where t.id = cycles.tracker_id and t.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.trackers t
      where t.id = cycles.tracker_id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "Cycles delete policy" on public.cycles;
create policy "Cycles delete policy"
  on public.cycles for delete to authenticated
  using (
    exists (
      select 1 from public.trackers t
      where t.id = cycles.tracker_id and t.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- RLS: partner_invites
-- Only the Owner can create, list, or revoke invites for their tracker
-- ------------------------------------------------------------------------------
drop policy if exists "Partner invites owner all" on public.partner_invites;
create policy "Partner invites owner all"
  on public.partner_invites for all to authenticated
  using (
    exists (
      select 1 from public.trackers t
      where t.id = partner_invites.tracker_id and t.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.trackers t
      where t.id = tracker_id and t.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- RLS: tracker_partners
-- Owner can view and revoke (delete) their partners.
-- Partner can view their own membership or leave (delete).
-- ------------------------------------------------------------------------------
drop policy if exists "Tracker partners select" on public.tracker_partners;
create policy "Tracker partners select"
  on public.tracker_partners for select to authenticated
  using (
    partner_user_id = auth.uid()
    or exists (
      select 1 from public.trackers t
      where t.id = tracker_partners.tracker_id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "Tracker partners delete" on public.tracker_partners;
create policy "Tracker partners delete"
  on public.tracker_partners for delete to authenticated
  using (
    partner_user_id = auth.uid()
    or exists (
      select 1 from public.trackers t
      where t.id = tracker_partners.tracker_id and t.owner_id = auth.uid()
    )
  );

-- ==============================================================================
-- 3. Stored Procedure: redeem_partner_invite
-- Runs as SECURITY DEFINER so that the authenticated Partner can validate
-- the token, join tracker_partners, and mark the invite used atomically
-- without exposing the service-role key client-side!
-- ==============================================================================

create or replace function public.redeem_partner_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invite record;
  v_tracker record;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Authentication required. Please log in first.');
  end if;

  -- 1. Find invite
  select * into v_invite
  from public.partner_invites
  where token = trim(invite_token);

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid invite link.');
  end if;

  -- 2. Validate unredeemed
  if v_invite.used_at is not null then
    return jsonb_build_object('success', false, 'error', 'This invite link has already been used.');
  end if;

  -- 3. Validate unexpired
  if v_invite.expires_at < now() then
    return jsonb_build_object('success', false, 'error', 'This invite link has expired (7 day validity).');
  end if;

  -- 4. Check tracker & prevent self-invite
  select * into v_tracker
  from public.trackers
  where id = v_invite.tracker_id;

  if v_tracker.owner_id = v_user_id then
    return jsonb_build_object('success', false, 'error', 'You cannot accept an invite to your own tracker.');
  end if;

  -- 5. Add partner membership atomically
  insert into public.tracker_partners (tracker_id, partner_user_id)
  values (v_invite.tracker_id, v_user_id)
  on conflict (tracker_id, partner_user_id) do nothing;

  -- 6. Mark invite as used
  update public.partner_invites
  set used_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'success', true,
    'tracker_id', v_invite.tracker_id,
    'partner_name', v_tracker.partner_name
  );
end;
$$;

grant execute on function public.redeem_partner_invite(text) to authenticated;

-- ==============================================================================
-- 4. Realtime Setup
-- Enable WebSocket push replication for instantaneous two-person syncing
-- ==============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cycles'
  ) then
    alter publication supabase_realtime add table public.cycles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trackers'
  ) then
    alter publication supabase_realtime add table public.trackers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracker_partners'
  ) then
    alter publication supabase_realtime add table public.tracker_partners;
  end if;
end $$;
