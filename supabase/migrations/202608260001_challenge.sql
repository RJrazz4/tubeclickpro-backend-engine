-- ===========================================================================
-- Migration 202608260001 — The 30-Day Viral Challenge (Module G)
--
-- Server-authoritative gamification:
--   * challenge_days is the append-only calendar (script | publish | freeze)
--   * streaks/freezes/milestones are COMPUTED (challenge_state RPC) — the
--     client never claims anything
--   * a freeze is auto-consumed for a missed past day if one has been earned
--     (1 earned per 7 elapsed days); consumption is itself a calendar row,
--     so the walk is idempotent and self-healing
-- Idempotent.
-- ===========================================================================

create table if not exists public.challenge_enrollments (
  user_id     uuid primary key references auth.users(id),
  timezone    text not null,                       -- IANA zone, pinned at enroll
  started_at  timestamptz not null default now(),
  start_date  date not null,                       -- first local day of the challenge
  status      text not null default 'active'
              check (status in ('active','completed','abandoned')),
  best_streak integer not null default 0,
  completed_at timestamptz,
  updated_at  timestamptz not null default now()
);

create index if not exists challenge_enrollments_status_idx
  on public.challenge_enrollments (status, start_date desc);

create table if not exists public.challenge_days (
  user_id      uuid not null references auth.users(id),
  local_date   date not null,
  action       text not null check (action in ('script','publish','freeze')),
  script_package_id uuid references public.script_packages(id),
  created_at   timestamptz not null default now(),
  primary key (user_id, local_date, action)
);

create index if not exists challenge_days_user_date_idx
  on public.challenge_days (user_id, local_date desc);

alter table public.challenge_enrollments enable row level security;
alter table public.challenge_days        enable row level security;

drop policy if exists "owner read challenge_enrollments" on public.challenge_enrollments;
create policy "owner read challenge_enrollments" on public.challenge_enrollments
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "owner read challenge_days" on public.challenge_days;
create policy "owner read challenge_days" on public.challenge_days
  for select to authenticated using (auth.uid() = user_id);
-- Writes: service role only.

-- ---------------------------------------------------------------------------
-- challenge_state(p_user_id, p_today_local)
--
-- ONE call returns everything the dashboard needs. Side effects (idempotent):
--   * auto-inserts 'freeze' rows for missed past days when earned
--   * flips status -> 'completed' + completed_at at 30 script-days
-- Caller computes p_today_local from the PINNED timezone (never trusts client
-- clocks; the date is derived server-side from the enrollment's zone).
-- ---------------------------------------------------------------------------
create or replace function public.challenge_state(p_user_id uuid, p_today_local date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  d date;
  v_today date := p_today_local;
  v_earned int;
  v_used int;
  v_scripts int;
  v_streak int := 0;
  v_cursor date;
  v_row record;
begin
  select * into e from public.challenge_enrollments where user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'not_enrolled');
  end if;
  if v_today < e.start_date then
    v_today := e.start_date;
  end if;

  select count(*) into v_used
    from public.challenge_days where user_id = p_user_id and action = 'freeze';

  -- Auto-consume freezes for missed PAST days (today stays pending).
  d := e.start_date;
  while d < v_today loop
    if not exists (select 1 from public.challenge_days
                    where user_id = p_user_id and local_date = d and action in ('script','freeze'))
    then
      v_earned := (d - e.start_date + 1) / 7;   -- integer division = floor
      if v_used < v_earned then
        insert into public.challenge_days (user_id, local_date, action)
        values (p_user_id, d, 'freeze')
        on conflict do nothing;
        v_used := v_used + 1;
      end if;
    end if;
    d := d + 1;
  end loop;

  select count(*) into v_scripts
    from public.challenge_days where user_id = p_user_id and action = 'script';

  -- Streak: consecutive script-or-freeze days ending today (or yesterday if
  -- today is still pending).
  v_cursor := case when exists (
      select 1 from public.challenge_days
       where user_id = p_user_id and local_date = v_today and action in ('script','freeze')
    ) then v_today else v_today - 1 end;

  while exists (select 1 from public.challenge_days
                 where user_id = p_user_id and local_date = v_cursor
                   and action in ('script','freeze')) loop
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  if v_streak > e.best_streak then
    update public.challenge_enrollments
       set best_streak = v_streak, updated_at = now()
     where user_id = p_user_id;
    e.best_streak := v_streak;
  end if;

  if v_scripts >= 30 and e.status = 'active' then
    update public.challenge_enrollments
       set status = 'completed', completed_at = now(), updated_at = now()
     where user_id = p_user_id;
    e.status := 'completed';
  end if;

  return jsonb_build_object(
    'status', e.status,
    'timezone', e.timezone,
    'start_date', to_char(e.start_date, 'YYYY-MM-DD'),
    'today_local', to_char(v_today, 'YYYY-MM-DD'),
    'elapsed_days', (v_today - e.start_date) + 1,
    'streak', v_streak,
    'best_streak', greatest(e.best_streak, v_streak),
    'freezes_used', v_used,
    'freezes_earned', ((v_today - e.start_date) + 1) / 7,
    'total_script_days', v_scripts,
    'total_publish_days', (select count(*) from public.challenge_days
                             where user_id = p_user_id and action = 'publish'),
    'calendar', (select coalesce(jsonb_agg(jsonb_build_object(
                    'date', to_char(local_date, 'YYYY-MM-DD'),
                    'action', action,
                    'script_package_id', script_package_id
                  ) order by local_date, action), '[]'::jsonb)
                   from public.challenge_days
                  where user_id = p_user_id
                    and local_date between e.start_date and v_today)
  );
end;
$$;

revoke execute on function public.challenge_state(uuid, date) from public, anon, authenticated;
do $$
begin
  grant execute on function public.challenge_state(uuid, date) to service_role;
exception when undefined_object then null;
end $$;
