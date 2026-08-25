-- ===========================================================================
-- Migration 202608250003 — publish tracking (Module P, closed learning loop)
-- Manual-paste v1 (locked decision). Idempotent.
-- ===========================================================================

create table if not exists public.script_outcomes (
  id                uuid primary key default gen_random_uuid(),
  script_package_id uuid not null references public.script_packages(id),
  user_id           uuid not null references auth.users(id),
  video_id          text not null,
  video_url         text not null,
  published_at      timestamptz not null default now(),
  measured_at       timestamptz,
  metrics           jsonb,
  created_at        timestamptz not null default now()
);

create unique index if not exists script_outcomes_package_key
  on public.script_outcomes (script_package_id);
create index if not exists script_outcomes_pending_idx
  on public.script_outcomes (published_at)
  where measured_at is null;

alter table public.script_outcomes enable row level security;

drop policy if exists "owner read script_outcomes" on public.script_outcomes;
create policy "owner read script_outcomes" on public.script_outcomes
  for select to authenticated using (auth.uid() = user_id);
-- Writes: service role only.
