-- Drive Home online leaderboard.
-- Paste this into Supabase → SQL Editor → Run (once).

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  map text not null check (map in ('home', 'windermere', 'sherwood', 'burger', 'beachclub', 'noodle')),
  car text not null check (char_length(car) <= 20),
  name text not null check (char_length(btrim(name)) between 1 and 16),
  time_ms integer not null check (time_ms between 5000 and 3600000),
  crashes integer not null default 0 check (crashes between 0 and 999),
  created_at timestamptz not null default now()
);

create index if not exists scores_map_time on public.scores (map, time_ms);

-- Anyone can read the board and add a score; nobody can edit or delete through the API.
alter table public.scores enable row level security;

drop policy if exists "read scores" on public.scores;
create policy "read scores" on public.scores for select to anon, authenticated using (true);

drop policy if exists "add scores" on public.scores;
create policy "add scores" on public.scores for insert to anon, authenticated with check (true);
