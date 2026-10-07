-- Drive Home database: online leaderboard + per-player progress.
-- Paste ALL of this into Supabase → SQL Editor → Run. Safe to run again.
-- Also turn on: Authentication → Sign In / Providers → "Allow anonymous sign-ins".
-- Every browser gets its own anonymous account; each account has one fixed name.

-- ---------- players ----------
create table if not exists public.player_progress (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  stats jsonb not null default '{}'::jsonb check (pg_column_size(stats) < 4000),
  achievements text[] not null default '{}' check (cardinality(achievements) <= 50),
  updated_at timestamptz not null default now()
);
alter table public.player_progress add column if not exists name text
  check (name is null or char_length(btrim(name)) between 1 and 16);
create unique index if not exists player_name_unique on public.player_progress (lower(btrim(name)));

-- A name can be picked once and never changed.
create or replace function public.lock_player_name() returns trigger language plpgsql as $$
begin
  if old.name is not null and new.name is distinct from old.name then
    raise exception 'name is already set and cannot be changed';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
drop trigger if exists lock_player_name on public.player_progress;
create trigger lock_player_name before update on public.player_progress
  for each row execute function public.lock_player_name();

alter table public.player_progress enable row level security;
drop policy if exists "read own progress" on public.player_progress;
create policy "read own progress" on public.player_progress for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "add own progress" on public.player_progress;
create policy "add own progress" on public.player_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "update own progress" on public.player_progress;
create policy "update own progress" on public.player_progress for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- scores ----------
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  map text not null check (map in ('home', 'windermere', 'sherwood', 'burger', 'beachclub', 'noodle', 'snowvalley', 'refinery')),
  car text not null check (char_length(car) <= 20),
  name text not null check (char_length(btrim(name)) between 1 and 16),
  time_ms integer not null check (time_ms between 5000 and 3600000),
  crashes integer not null default 0 check (crashes between 0 and 999),
  created_at timestamptz not null default now()
);
alter table public.scores add column if not exists user_id uuid references auth.users (id) on delete cascade;
-- Keep the allowed map list current on an existing table.
alter table public.scores drop constraint if exists scores_map_check;
alter table public.scores add constraint scores_map_check
  check (map in ('home', 'windermere', 'sherwood', 'burger', 'beachclub', 'noodle', 'snowvalley', 'refinery'));
create index if not exists scores_map_time on public.scores (map, time_ms);

-- Scores always carry the poster's account and its fixed name, whatever the client sends.
create or replace function public.stamp_score() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  select p.name into new.name from public.player_progress p where p.user_id = auth.uid();
  if new.user_id is null or new.name is null then
    raise exception 'pick a player name before posting a time';
  end if;
  return new;
end $$;
drop trigger if exists stamp_score on public.scores;
create trigger stamp_score before insert on public.scores
  for each row execute function public.stamp_score();

alter table public.scores enable row level security;
drop policy if exists "read scores" on public.scores;
create policy "read scores" on public.scores for select to anon, authenticated using (true);
drop policy if exists "add scores" on public.scores;
create policy "add scores" on public.scores for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Each player's best time per map.
create or replace view public.leaderboard with (security_invoker = true) as
  select distinct on (map, coalesce(user_id::text, lower(name))) map, name, car, time_ms
  from public.scores
  order by map, coalesce(user_id::text, lower(name)), time_ms;
grant select on public.leaderboard to anon, authenticated;
