-- ===========================================================================
-- Migration 202608250001 — Audience Engine (T‑2A-02 + T‑2A‑03)
--
--   1. yt_videos catalog (topic vocabulary + durations for format split)
--   2. New validated metric columns (engagedViews, watchRatio, card teaser)
--   3. yt_audience_geo gains `city` (non-US sub-national geo) + extended PK
--   4. audience_profiles + audience_hungers (Hunger Score™ storage)
--   5. compute_audience_profile() RPC — the deterministic engine
--
-- Idempotent; handles Phase-1 rows that may already exist in production.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Video catalog — the topic join key (tags) + durations (Shorts split)
-- ---------------------------------------------------------------------------
create table if not exists public.yt_videos (
  user_id        uuid not null references auth.users(id),
  video_id       text not null,
  title          text not null default '',
  tags           text[] not null default '{}',
  duration_seconds integer not null default 0,
  published_at   timestamptz,
  lang           text not null default '',
  views_lifetime bigint not null default 0,
  refreshed_at   timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists yt_videos_published_idx
  on public.yt_videos (user_id, published_at desc);

-- ---------------------------------------------------------------------------
-- 2. New validated metric columns
-- ---------------------------------------------------------------------------
alter table public.yt_video_daily
  add column if not exists engaged_views bigint not null default 0,
  add column if not exists audience_watch_ratio numeric(6,4) not null default 0,
  add column if not exists card_teaser_impressions bigint not null default 0,
  add column if not exists card_teaser_click_rate numeric(6,4) not null default 0;

alter table public.yt_channel_daily
  add column if not exists engaged_views bigint not null default 0;

-- ---------------------------------------------------------------------------
-- 3. Geo gains `city` (province is US-only per the API; city covers India).
--    Default '' preserves existing-row uniqueness, so the PK swap is safe.
-- ---------------------------------------------------------------------------
alter table public.yt_audience_geo
  add column if not exists city text not null default '';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'yt_audience_geo_pkey' and conrelid = 'public.yt_audience_geo'::regclass
  ) then
    alter table public.yt_audience_geo drop constraint yt_audience_geo_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'yt_audience_geo_city_pkey' and conrelid = 'public.yt_audience_geo'::regclass
  ) then
    alter table public.yt_audience_geo
      add constraint yt_audience_geo_city_pkey
      primary key (user_id, video_id, stat_date, country, province, city);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Profile + hunger storage
-- ---------------------------------------------------------------------------
create table if not exists public.audience_profiles (
  user_id      uuid primary key references auth.users(id),
  version      integer not null default 1,
  computed_at  timestamptz not null default now(),
  freshness    text not null default 'empty'
               check (freshness in ('fresh','stale','cold','empty')),
  rollups      jsonb not null default '{}'::jsonb,
  rollups_hash text not null default '',
  narrative    jsonb
);

create table if not exists public.audience_hungers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  topic        text not null,
  rank         integer not null check (rank > 0),
  score        numeric(6,5) not null,
  evidence     jsonb not null default '{}'::jsonb,
  geo          jsonb not null default '{}'::jsonb,
  computed_at  timestamptz not null default now()
);

create unique index if not exists audience_hungers_user_rank_key
  on public.audience_hungers (user_id, rank);
create index if not exists audience_hungers_topic_idx
  on public.audience_hungers (user_id, topic);

alter table public.yt_videos          enable row level security;
alter table public.audience_profiles  enable row level security;
alter table public.audience_hungers   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['yt_videos','audience_profiles','audience_hungers'] loop
    execute format('drop policy if exists "owner read %1$s" on public.%1$I', t);
    execute format(
      'create policy "owner read %1$s" on public.%1$I for select to authenticated using (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. compute_audience_profile — the deterministic Audience Behavior Engine.
--
--    ONE call per user. Everything is computed IN the database from the
--    ingested Phase-1/2 tables; no rows leave Postgres. Hunger Score v1:
--      0.30·norm(watch_share) + 0.20·norm(click_lift) + 0.15·radar + 0.35·norm(supply_gap)
--    radar = 0 in v1 (viral_dna_runs outlier join ships with Module B wiring);
--    version column bumps whenever the formula changes.
--
--    Click appetite uses the validated proxy set (no public impressions):
--      er = (likes+comments+shares)/views ; hook = engaged_views/views ;
--      card teaser rates as a secondary signal.
-- ---------------------------------------------------------------------------
create or replace function public.compute_audience_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_win  date := current_date - 28;
  v_sup  date := current_date - 90;
  v_rollups jsonb;
  v_hash text;
  v_geo jsonb; v_cities jsonb; v_demo jsonb; v_traffic jsonb;
  v_tech jsonb; v_subs jsonb; v_dow jsonb; v_format jsonb; v_retention jsonb;
  v_topics jsonb;
  v_top_country text;
  v_total_minutes numeric;
  v_total_supply integer;
  v_channel_er numeric := 0;
  v_count integer;
begin
  select count(*) into v_count from public.yt_channel_daily where user_id = p_user_id;
  if v_count = 0 then
    insert into public.audience_profiles (user_id, freshness, rollups, rollups_hash)
    values (p_user_id, 'empty', '{}'::jsonb, '')
    on conflict (user_id) do update
      set freshness = 'empty', rollups = '{}'::jsonb, rollups_hash = '', narrative = null,
          computed_at = now();
    delete from public.audience_hungers where user_id = p_user_id;
    return jsonb_build_object('status', 'empty');
  end if;

  -- ============ GEO (country share by watch minutes, 28d) ============
  select sum(estimated_minutes_watched) into v_total_minutes
    from public.yt_audience_geo
   where user_id = p_user_id and video_id = '~channel' and stat_date >= v_win;

  select country into v_top_country
    from public.yt_audience_geo
   where user_id = p_user_id and video_id = '~channel' and stat_date >= v_win
   group by country
   order by sum(estimated_minutes_watched) desc nulls last
   limit 1;

  select jsonb_agg(row_to_json(g) order by g.minutes desc) into v_geo
    from (
      select country,
             round(sum(estimated_minutes_watched)::numeric / greatest(v_total_minutes,1) * 100, 1) as watch_share_pct,
             sum(estimated_minutes_watched) as minutes
        from public.yt_audience_geo
       where user_id = p_user_id and video_id = '~channel' and stat_date >= v_win
       group by country
       order by 3 desc
       limit 10
    ) g;

  -- NOTE: API city rows carry no country pairing, so cities are ranked
  -- across the whole channel (city codes mapped to names in a later slice).
  select jsonb_agg(row_to_json(c) order by c.minutes desc) into v_cities
    FROM (
      select city, sum(estimated_minutes_watched) as minutes,
             round(sum(estimated_minutes_watched)::numeric / greatest(
               (select sum(estimated_minutes_watched) from public.yt_audience_geo
                 where user_id = p_user_id and video_id = '~channel'
                   and stat_date >= v_win and city <> ''),1) * 100, 1) as share_pct
        from public.yt_audience_geo
       where user_id = p_user_id and video_id = '~channel'
         and stat_date >= v_win and city <> ''
       group by city
       order by 2 desc
       limit 10
    ) c;

  -- ============ DEMOGRAPHICS (channel-level by API) ============
  select jsonb_agg(row_to_json(d) order by d.views desc) into v_demo
    FROM (
      select age_group, gender,
             sum(views) as views,
             round(sum(views)::numeric / greatest((select sum(views) from public.yt_audience_demo
                where user_id = p_user_id and stat_date >= v_win),1) * 100, 1) as view_share_pct,
             sum(estimated_minutes_watched) as minutes
        from public.yt_audience_demo
       where user_id = p_user_id and stat_date >= v_win
       group by age_group, gender
       order by 3 desc
       limit 8
    ) d;

  -- ============ TRAFFIC MIX ============
  select jsonb_agg(row_to_json(t) order by t.views desc) into v_traffic
    FROM (
      select source, sum(views) as views,
             round(sum(views)::numeric / greatest((select sum(views) from public.yt_traffic_sources
                where user_id = p_user_id and stat_date >= v_win),1) * 100, 1) as share_pct
        from public.yt_traffic_sources
       where user_id = p_user_id and stat_date >= v_win
       group by source order by 2 desc limit 8
    ) t;

  -- ============ TECH + SUBS ============
  select jsonb_build_object(
    'mobile_share_pct',
      round(coalesce((select sum(views) from public.yt_audience_tech
         where user_id = p_user_id and stat_date >= v_win and device = 'MOBILE'),0)::numeric
        / greatest((select sum(views) from public.yt_audience_tech
         where user_id = p_user_id and stat_date >= v_win),1) * 100, 1)
  ) into v_tech;

  select jsonb_agg(row_to_json(s) order by s.views desc) into v_subs
    FROM (
      select subscriber_status as status, sum(views) as views,
             round(sum(views)::numeric / greatest((select sum(views) from public.yt_audience_subs
                where user_id = p_user_id and stat_date >= v_win),1) * 100, 1) as share_pct
        from public.yt_audience_subs
       where user_id = p_user_id and stat_date >= v_win
       group by subscriber_status
    ) s;

  -- ============ DAY-OF-WEEK HEAT (views by weekday, 28d) ============
  select jsonb_agg(jsonb_build_object('dow', dow, 'views', views) order by dow) into v_dow
    FROM (select extract(isodow from stat_date)::int as dow, sum(views) as views
        from public.yt_channel_daily where user_id = p_user_id and stat_date >= v_win
       group by 1) w;

  -- ============ FORMAT SPLIT (Shorts vs long-form, catalog durations) ============
  select jsonb_build_object(
    'shorts_videos', count(*) filter (where duration_seconds <= 60),
    'long_videos',   count(*) filter (where duration_seconds > 60)
  ) into v_format
    from public.yt_videos where user_id = p_user_id;

  -- ============ RETENTION CLASSES (top 20 videos by 28d views) ============
  select jsonb_agg(row_to_json(r) order by r.views desc) into v_retention
    FROM (
      select d.video_id, d.views, d.average_view_percentage, d.audience_watch_ratio,
             case
               when d.engaged_views::numeric / greatest(d.views,1) < 0.65 then 'weak_hook'
               when d.audience_watch_ratio >= 0.45 then 'strong_end'
               when d.average_view_percentage < 35 then 'mid_sag'
               else 'steady'
             end as class
        from public.yt_video_daily d
       where d.user_id = p_user_id and d.stat_date >= v_win
       order by d.views desc limit 20
    ) r;

  -- ============ TOPICS + HUNGER (tags vocabulary, 28d metrics) ============
  -- atomic replace: previous run's cards go first (unique (user_id, rank))
  delete from public.audience_hungers where user_id = p_user_id;

  select count(*) into v_total_supply
    from public.yt_videos where user_id = p_user_id and published_at >= v_sup;

  -- channel-level engagement rate (28d, ALL videos — the lift denominator)
  select case when coalesce(sum(views),0) > 0
         then round((sum(likes + comments + shares))::numeric / sum(views), 4)
         else 0 end
    into v_channel_er
    from public.yt_video_daily
   where user_id = p_user_id and stat_date >= v_win;

  with per_video as (
    select v.video_id, lower(t) as topic,
           d.estimated_minutes_watched as m, d.views,
           d.engaged_views, (d.likes + d.comments + d.shares) as eng
      from public.yt_videos v
      join public.yt_video_daily d on d.user_id = v.user_id and d.video_id = v.video_id
      cross join lateral unnest(v.tags) as t
     where v.user_id = p_user_id and d.stat_date >= v_win and array_length(v.tags, 1) > 0
  ),
  topic_base as (
    select pv.topic,
           sum(pv.m)::numeric as minutes,
           sum(pv.views) as views,
           case when sum(pv.views) > 0
                then round(sum(pv.eng)::numeric / sum(pv.views), 4) else 0 end as er,
           case when sum(pv.views) > 0
                then round(sum(pv.engaged_views)::numeric / sum(pv.views), 4) else 0 end as hook,
           count(distinct pv.video_id) as demand_videos,
           (select count(*) from public.yt_videos v2
             where v2.user_id = p_user_id and v2.published_at >= v_sup
               and exists (select 1 from unnest(v2.tags) x where lower(x) = pv.topic)) as supply_90d
      from per_video pv
     where pv.topic <> '' and length(pv.topic) >= 3
       and pv.topic not in ('new','video','youtube','videos','shorts','viral','trending','latest','best','top')
     group by pv.topic
    having count(distinct pv.video_id) >= 2
  ),
  scalars as (
    select coalesce(sum(minutes),0)::numeric as total_minutes,
           coalesce(max(minutes),0)::numeric as max_minutes,
           greatest(v_total_supply, 1)::numeric as supply_total
      from topic_base
  ),
  scored as (
    select tb.topic, tb.minutes, tb.views, tb.er, tb.hook,
           tb.demand_videos, tb.supply_90d, s.total_minutes,
           0.30 * (tb.minutes / greatest(s.max_minutes, 1))
         + 0.20 * (least(greatest(tb.er / greatest(v_channel_er, 0.0001), 0), 1.5) / 1.5)
         + 0.15 * 0  -- radar outlier join ships with Module B wiring (v1)
         + 0.35 * (least((tb.minutes / greatest(s.total_minutes, 1)) /
                 (tb.supply_90d::numeric / s.supply_total + 0.05), 4) / 4) as score
      from topic_base tb cross join scalars s
  )
  insert into public.audience_hungers (user_id, topic, rank, score, evidence, geo)
  select p_user_id, topic, row_number() over (order by score desc, minutes desc),
         round(score::numeric, 5),
         jsonb_build_object(
           'watch_share_pct', round(minutes / greatest(total_minutes, 1) * 100, 1),
           'engagement_rate', er,
           'hook_retention', hook,
           'demand_videos_28d', demand_videos,
           'supply_videos_90d', supply_90d,
           'sample_video_ids', (select coalesce(jsonb_agg(vv), '[]'::jsonb) from (
                select pv.video_id from per_video pv
                 where pv.topic = scored.topic
                 group by pv.video_id
                 order by sum(pv.m) desc limit 3) vv)
         ),
         jsonb_build_object('country', v_top_country,
                            'watch_share_pct', (select x.watch_share_pct from jsonb_to_recordset(coalesce(v_geo, '[]'::jsonb)) as x(country text, watch_share_pct numeric, minutes numeric) where x.country = v_top_country limit 1))
    from scored
   where score > 0.05
   order by score desc
   limit 10;

  -- refresh computed_at on hungers for this run
  update public.audience_hungers set computed_at = now() where user_id = p_user_id;

  -- ============ ASSEMBLE ============
  v_rollups := jsonb_build_object(
    'window', jsonb_build_object('days', 28, 'supply_days', 90),
    'geo', coalesce(v_geo, '[]'::jsonb),
    'top_country', v_top_country,
    'cities_top_country', coalesce(v_cities, '[]'::jsonb),
    'demo_pyramid', coalesce(v_demo, '[]'::jsonb),
    'traffic_mix', coalesce(v_traffic, '[]'::jsonb),
    'tech', coalesce(v_tech, '{}'::jsonb),
    'subscriber_mix', coalesce(v_subs, '[]'::jsonb),
    'day_of_week', coalesce(v_dow, '[]'::jsonb),
    'format_split', coalesce(v_format, '{}'::jsonb),
    'retention_top20', coalesce(v_retention, '[]'::jsonb)
  );
  v_hash := md5(v_rollups::text);

  insert into public.audience_profiles (user_id, version, computed_at, freshness, rollups, rollups_hash)
  values (p_user_id, 1, now(), 'fresh', v_rollups, v_hash)
  on conflict (user_id) do update
    set version = public.audience_profiles.version,
        computed_at = now(),
        freshness = 'fresh',
        rollups = excluded.rollups,
        rollups_hash = excluded.rollups_hash,
        narrative = case when public.audience_profiles.rollups_hash = excluded.rollups_hash
                         then public.audience_profiles.narrative else null end;

  return jsonb_build_object('status', 'ok', 'rollups_hash', v_hash,
    'hunger_count', (select count(*) from public.audience_hungers where user_id = p_user_id));
end;
$$;

revoke execute on function public.compute_audience_profile(uuid) from public, anon, authenticated;
do $$
begin
  grant execute on function public.compute_audience_profile(uuid) to service_role;
exception when undefined_object then null;
end $$;
