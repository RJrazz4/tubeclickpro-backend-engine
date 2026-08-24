-- ===========================================================================
-- Migration 202608240001 — YouTube Signal Link (Module O + quota ledger)
--
-- OAuth connect flow (PKCE state), the encrypted token vault, and the
-- platform-wide API quota ledger. Idempotent; safe to re-run.
--
-- Security posture (mirrors the payment verifier):
--   * youtube_connections holds ENCRYPTED refresh tokens (AES-256-GCM from
--     the app; ciphertext only) — RLS enabled, ZERO policies: readable and
--     writable exclusively by the service role.
--   * youtube_oauth_state rows are single-use and expire in 10 minutes.
--   * youtube_quota_ledger is internal-only (service role).
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. youtube_oauth_state — one-time CSRF/PKCE state for the connect flow.
-- ---------------------------------------------------------------------------
create table if not exists public.youtube_oauth_state (
  state        text primary key,
  user_id      uuid not null references auth.users(id),
  code_verifier text not null,
  redirect_to  text not null default '/',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists youtube_oauth_state_user_idx
  on public.youtube_oauth_state (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. youtube_connections — the Token Vault. ONE active connection per user.
--    refresh_enc = nonce(12) || ciphertext || tag(16) — AES-256-GCM with the
--    app-held YOUTUBE_TOKEN_MASTER_KEY. Access tokens are NEVER stored here;
--    they live in Redis with a 55-minute TTL only.
-- ---------------------------------------------------------------------------
create table if not exists public.youtube_connections (
  user_id            uuid primary key references auth.users(id),
  channel_id         text not null,
  channel_handle     text,
  channel_title      text,
  scopes_granted     text[] not null,
  refresh_enc        bytea not null,
  refresh_rotated_at timestamptz,
  status             text not null default 'active'
                     check (status in ('active','expired','revoked','error')),
  last_sync_at       timestamptz,
  sync_error         text,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists youtube_connections_channel_key
  on public.youtube_connections (channel_id)
  where status = 'active';

create index if not exists youtube_connections_active_idx
  on public.youtube_connections (status, connected_at desc);

-- One connect attempt per user per minute (abuse guard is app-side; this
-- keeps history tidy).
create index if not exists youtube_oauth_state_expiry_idx
  on public.youtube_oauth_state (expires_at);

-- ---------------------------------------------------------------------------
-- 3. youtube_quota_ledger — durable record of every billable API unit spent.
--    The hot path is Redis (atomic INCR + decide); this table is the flushed,
--    auditable projection used for analytics and budget tuning.
--    priority: 1 = user-triggered, 2 = scheduled sync, 3 = radar/background.
-- ---------------------------------------------------------------------------
create table if not exists public.youtube_quota_ledger (
  id         bigint generated always as identity primary key,
  day        date not null,
  api        text not null check (api in ('data','analytics')),
  user_id    uuid,                    -- null = platform-wide job
  units      integer not null,
  priority   smallint not null check (priority between 1 and 3),
  endpoint   text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists youtube_quota_ledger_day_idx
  on public.youtube_quota_ledger (day, api);

create index if not exists youtube_quota_ledger_user_day_idx
  on public.youtube_quota_ledger (user_id, day)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 4. RLS — default deny. No policies on these three tables: the browser must
--    never read the vault, the state rows, or the ledger. Service role only.
-- ---------------------------------------------------------------------------
alter table public.youtube_oauth_state  enable row level security;
alter table public.youtube_connections  enable row level security;
alter table public.youtube_quota_ledger enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Housekeeping RPC — prune expired oauth state rows. SECURITY DEFINER so
--    the worker can call it via RPC without table grants.
-- ---------------------------------------------------------------------------
create or replace function public.prune_youtube_oauth_state()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.youtube_oauth_state
     where expires_at < now()
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- Internal-only RPC: never expose to anon/authenticated over PostgREST.
revoke execute on function public.prune_youtube_oauth_state() from public, anon, authenticated;
do $$
begin
  grant execute on function public.prune_youtube_oauth_state() to service_role;
exception when undefined_object then null;
end $$;
