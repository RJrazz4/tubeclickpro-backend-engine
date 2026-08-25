-- ===========================================================================
-- Migration 202608250002 — script_packages (Crush synthesis storage, T‑2B-02)
-- Idempotent.
-- ===========================================================================

create table if not exists public.script_packages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id),
  tier            text not null check (tier in ('free','premium')),
  kind            text not null check (kind in ('outline','package')),
  hunger_topic    text,
  grounding_hash  text not null default '',
  prompt_version  text not null default '',
  status          text not null default 'draft'
                  check (status in ('draft','approved','rejected','in_production','published','measured')),
  package         jsonb,
  critic          jsonb,
  cost_usd        numeric(8,4) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists script_packages_user_created_idx
  on public.script_packages (user_id, created_at desc);
create index if not exists script_packages_status_idx
  on public.script_packages (user_id, status);

alter table public.script_packages enable row level security;

drop policy if exists "owner read script_packages" on public.script_packages;
create policy "owner read script_packages" on public.script_packages
  for select to authenticated using (auth.uid() = user_id);
-- Writes: service role only (worker).
