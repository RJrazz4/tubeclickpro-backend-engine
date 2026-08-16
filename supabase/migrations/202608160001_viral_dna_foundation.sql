-- TubeClick Pro Viral DNA backend foundation.
-- The backend service role writes; authenticated clients can only read their rows.

create extension if not exists pgcrypto;

create table if not exists public.channel_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_channel_id text,
  fingerprint jsonb not null default '{}'::jsonb,
  memory_version integer not null default 1 check (memory_version > 0),
  updated_at timestamptz not null default now(),
  unique (user_id, youtube_channel_id)
);

create table if not exists public.viral_dna_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null check (tier in ('free', 'premium')),
  queue_class text not null check (queue_class in ('conveyor', 'vip')),
  delivery text not null check (delivery in ('polling', 'sse')),
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  stage text not null,
  result jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists viral_dna_runs_user_created_idx
  on public.viral_dna_runs (user_id, created_at desc);
create index if not exists viral_dna_runs_status_updated_idx
  on public.viral_dna_runs (status, updated_at);

create table if not exists public.viral_dna_extraction_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.viral_dna_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  duration_ms integer check (duration_ms >= 0),
  challenge_detected boolean not null default false,
  fallback_used boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.channel_profiles enable row level security;
alter table public.viral_dna_runs enable row level security;
alter table public.viral_dna_extraction_logs enable row level security;

create policy "users read own channel profiles"
  on public.channel_profiles for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users read own viral DNA runs"
  on public.viral_dna_runs for select
  to authenticated
  using (auth.uid() = user_id);

-- No authenticated-client insert/update/delete policies are created. All
-- mutations are server-authoritative through the backend service role.
