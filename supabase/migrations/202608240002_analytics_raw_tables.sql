-- ===========================================================================
-- Migration 202608240002 — Analytics ingestion tables (Module S, Phase 1)
--
-- Derived, queryable aggregates (kept forever) + raw report JSON
-- (30-day TTL, pruned by the worker — YouTube API developer policies limit
-- raw retention; derived aggregates are exempt).
--
-- RLS: owners can READ their own analytics (dashboard reads); all writes go
-- through the service role (worker). Natural-key unique indexes make every
-- upsert idempotent, so syncs can be re-run at any time.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. yt_channel_daily — channel-level daily metrics.
-- ---------------------------------------------------------------------------
create table if not exists public.yt_channel_daily (
  user_id            uuid not null references auth.users(id),
  stat_date          date not null,
  views              bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  average_view_duration_seconds integer not null default 0,
  average_view_percentage numeric(6,3) not null default 0,
  subscribers_gained integer not null default 0,
  subscribers_lost   integer not null default 0,
  likes              bigint not null default 0,
  comments           bigint not null default 0,
  shares             bigint not null default 0,
  impressions        bigint not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (user_id, stat_date)
);

-- ---------------------------------------------------------------------------
-- 2. yt_video_daily — per-video daily metrics.
-- ---------------------------------------------------------------------------
create table if not exists public.yt_video_daily (
  user_id            uuid not null references auth.users(id),
  video_id           text not null,
  stat_date          date not null,
  views              bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  average_view_duration_seconds integer not null default 0,
  average_view_percentage numeric(6,3) not null default 0,
  likes              bigint not null default 0,
  comments           bigint not null default 0,
  shares             bigint not null default 0,
  impressions        bigint not null default 0,
  updated_at         timestamptz not null default now(),
  primary key (user_id, video_id, stat_date)
);

create index if not exists yt_video_daily_video_idx
  on public.yt_video_daily (user_id, video_id, stat_date desc);

-- ---------------------------------------------------------------------------
-- 3. yt_audience_geo — country/province; video_id='~channel' = channel-level.
--    Sentinel values (not NULL) keep the composite PK expressible in plain
--    columns, so PostgREST upserts can target it with onConflict(column list).
-- ---------------------------------------------------------------------------
create table if not exists public.yt_audience_geo (
  user_id    uuid not null references auth.users(id),
  video_id   text not null default '~channel',
  stat_date  date not null,
  country    text not null,
  province   text not null default '',
  views      bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, video_id, stat_date, country, province)
);

-- ---------------------------------------------------------------------------
-- 4. yt_audience_demo — ageGroup x gender (channel-level only per API).
-- ---------------------------------------------------------------------------
create table if not exists public.yt_audience_demo (
  user_id    uuid not null references auth.users(id),
  stat_date  date not null,
  age_group  text not null,
  gender     text not null,
  views      bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_date, age_group, gender)
);

-- ---------------------------------------------------------------------------
-- 5. yt_traffic_sources — trafficSource dimension (channel or video).
-- ---------------------------------------------------------------------------
create table if not exists public.yt_traffic_sources (
  user_id    uuid not null references auth.users(id),
  video_id   text not null default '~channel',
  stat_date  date not null,
  source     text not null,
  views      bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, video_id, stat_date, source)
);

-- ---------------------------------------------------------------------------
-- 6. yt_audience_tech — device + OS.
-- ---------------------------------------------------------------------------
create table if not exists public.yt_audience_tech (
  user_id    uuid not null references auth.users(id),
  stat_date  date not null,
  device     text not null,
  operating_system text not null,
  views      bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_date, device, operating_system)
);

-- ---------------------------------------------------------------------------
-- 7. yt_audience_subs — subscriberStatus dimension.
-- ---------------------------------------------------------------------------
create table if not exists public.yt_audience_subs (
  user_id    uuid not null references auth.users(id),
  stat_date  date not null,
  subscriber_status text not null,
  views      bigint not null default 0,
  estimated_minutes_watched bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_date, subscriber_status)
);

-- ---------------------------------------------------------------------------
-- 8. yt_discovery_queries — insightTrafficSourceDetail (what viewers
--    searched before landing on a video). Only fetched for top videos.
-- ---------------------------------------------------------------------------
create table if not exists public.yt_discovery_queries (
  user_id    uuid not null references auth.users(id),
  video_id   text not null,
  stat_date  date not null,
  detail     text not null,
  views      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, video_id, stat_date, detail)
);

-- ---------------------------------------------------------------------------
-- 9. yt_report_raw — raw report JSON for audit/replay. 30-DAY TTL.
-- ---------------------------------------------------------------------------
create table if not exists public.yt_report_raw (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  report_key   text not null,          -- e.g. 'channel_daily'
  window_start date not null,
  window_end   date not null,
  payload      jsonb not null,
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists yt_report_raw_expiry_idx on public.yt_report_raw (expires_at);
create index if not exists yt_report_raw_lookup_idx on public.yt_report_raw (user_id, report_key, window_end desc);

-- ---------------------------------------------------------------------------
-- 10. youtube_sync_state — resumable backfill cursor per user.
-- ---------------------------------------------------------------------------
create table if not exists public.youtube_sync_state (
  user_id       uuid primary key references auth.users(id),
  phase         text not null default 'idle'
                check (phase in ('idle','backfilling','daily','error')),
  completed_through date,              -- last fully-synced stat_date
  windows_done  jsonb not null default '[]'::jsonb,
  last_error    text,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 11. RLS — owner-read for analytics tables; writes service-role only.
-- ---------------------------------------------------------------------------
alter table public.yt_channel_daily      enable row level security;
alter table public.yt_video_daily        enable row level security;
alter table public.yt_audience_geo       enable row level security;
alter table public.yt_audience_demo      enable row level security;
alter table public.yt_traffic_sources    enable row level security;
alter table public.yt_audience_tech      enable row level security;
alter table public.yt_audience_subs      enable row level security;
alter table public.yt_discovery_queries  enable row level security;
alter table public.yt_report_raw         enable row level security;
alter table public.youtube_sync_state    enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'yt_channel_daily','yt_video_daily','yt_audience_geo','yt_audience_demo',
    'yt_traffic_sources','yt_audience_tech','yt_audience_subs',
    'yt_discovery_queries','yt_report_raw','youtube_sync_state'
  ] loop
    execute format('drop policy if exists "owner read %1$s" on public.%1$I', t);
    execute format(
      'create policy "owner read %1$s" on public.%1$I for select to authenticated using (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Pruner — deletes expired raw reports and stale oauth state. Called by
--     the worker on a schedule; also safe to run manually.
-- ---------------------------------------------------------------------------
create or replace function public.prune_youtube_raw()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw_deleted integer := 0;
begin
  with deleted as (
    delete from public.yt_report_raw
     where expires_at < now()
    returning 1
  )
  select count(*) into v_raw_deleted from deleted;

  return jsonb_build_object('raw_deleted', v_raw_deleted, 'ran_at', now());
end;
$$;

revoke execute on function public.prune_youtube_raw() from public, anon, authenticated;
do $$
begin
  grant execute on function public.prune_youtube_raw() to service_role;
exception when undefined_object then null;
end $$;
