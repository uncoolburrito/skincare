-- ==============================================================================
-- Migration: backfill_ramiz.sql
-- One-off backfill script for Ramiz's tracker to parameterize existing hardcoded routines.
-- DO NOT commit into supabase_schema.sql (which remains generic for new users).
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/whekrgnecterjouoyxer/sql/new
-- ==============================================================================

-- 1. Ensure columns exist on public.trackers
alter table public.trackers
  add column if not exists routine_config jsonb,
  add column if not exists progress_gain_tau_days numeric default 60,
  add column if not exists progress_decay_tau_days numeric default 58,
  add column if not exists has_titration_schedule boolean default false,
  add column if not exists titration_phase_thresholds jsonb default '[7, 21]'::jsonb;

-- 2. Recreate trackers_view so new columns are exposed to the frontend
drop view if exists public.trackers_view;

create view public.trackers_view with (security_invoker = false) as
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
  t.after_sleep_cue,
  t.before_sleep_cue,
  t.grace_log,
  t.partner_alerted_cycle_id,
  t.last_partner_nudge_at,
  t.routine_config,
  t.progress_gain_tau_days,
  t.progress_decay_tau_days,
  t.has_titration_schedule,
  t.titration_phase_thresholds,
  t.created_at,
  case
    when t.owner_id = auth.uid() then 'owner'
    else 'partner'
  end as user_role
from public.trackers t
where
  t.owner_id = auth.uid()
  or exists (
    select 1
    from public.tracker_partners tp
    where tp.tracker_id = t.id
      and tp.partner_user_id = auth.uid()
  );

grant select on public.trackers_view to authenticated;

-- 3. Backfill Ramiz's specific tracker with exact routine text and parameters
update public.trackers
set
  routine_config = '{
    "afterSleep": {
      "title": "After Sleep Routine",
      "steps": ["Wash", "Azelaic acid 10%", "Moisturizer", "Sunscreen"],
      "subtext": "Consistent across all phases for barrier defense and tone."
    },
    "beforeSleep": {
      "title": "Before Sleep Routine",
      "steps": ["Wash", "Adapalene 0.1%", "Moisturizer"],
      "titration": {
        "productName": "Adapalene 0.1%",
        "productShort": "Adapalene",
        "activeSteps": "Wash → Adapalene 0.1% → Moisturizer",
        "restSteps": "Wash → Moisturizer only",
        "activeSubtext": "Active pimple? Spot-treat with benzoyl peroxide on a different spot only.",
        "restSubtext": "Active pimple? Fine to spot-treat with benzoyl peroxide tonight.",
        "phaseNames": ["Build-up", "Building Nightly", "Maintenance"]
      }
    }
  }'::jsonb,
  progress_gain_tau_days = 60,
  progress_decay_tau_days = 58,
  has_titration_schedule = true,
  titration_phase_thresholds = '[7, 21]'::jsonb;

-- 4. Return the updated tracker row to verify
select
  id,
  owner_id,
  has_titration_schedule,
  progress_gain_tau_days,
  progress_decay_tau_days,
  titration_phase_thresholds,
  routine_config
from public.trackers;
