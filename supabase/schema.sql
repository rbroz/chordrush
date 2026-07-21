-- ChordRush database schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).

-- ============================================================
-- 1. PROFILES — one row per user, holds the public username.
--    Supabase manages the auth.users table; profiles extends it
--    with our app-specific data, linked by id.
-- ============================================================
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now(),
  -- 3–20 chars, letters/numbers/underscore only
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

-- Case-insensitive uniqueness: "Rhett" and "rhett" can't both exist.
create unique index profiles_username_lower_idx on public.profiles (lower(username));

-- ============================================================
-- 2. SCORES — every completed run (not just top 5), so we can
--    compute top-5, history, and stats later from one source.
-- ============================================================
create table public.scores (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  mode        text not null,                    -- 'major' | 'minor' | 'major+minor'
  time_ms     integer not null check (time_ms > 0),
  chord_count smallint,                         -- 12 or 24, for context
  played_at   timestamptz,                      -- client run-finish time; unique per run (dedup key + true date)
  created_at  timestamptz not null default now()
);

-- Fast "my best times for this mode": WHERE user_id=? AND mode=? ORDER BY time_ms
create index scores_user_mode_time_idx on public.scores (user_id, mode, time_ms);

-- Idempotency: a run can't be recorded twice. (NULLs are distinct, so legacy
-- rows without played_at are unaffected.) Inserts use ON CONFLICT DO NOTHING.
create unique index scores_user_playedat_uidx on public.scores (user_id, played_at);

-- ============================================================
-- 3. ROW-LEVEL SECURITY (RLS)
--    With RLS on, the default is DENY. Nothing is readable or
--    writable until a policy explicitly allows it. This is what
--    stops user A from touching user B's data.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.scores   enable row level security;

-- profiles: usernames are public handles → anyone may read them;
-- but you can only create/update your OWN profile row.
create policy "profiles are viewable by everyone"
  on public.profiles for select using (true);
create policy "users insert their own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "users update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- scores: private for now — you can only read and add your OWN.
-- (We'll add a public read path when we build the shared leaderboard.)
create policy "users view their own scores"
  on public.scores for select using (auth.uid() = user_id);
create policy "users insert their own scores"
  on public.scores for insert with check (auth.uid() = user_id);

-- ============================================================
-- 4. AUTO-CREATE a profile on signup.
--    When Supabase Auth inserts a new user, this trigger copies
--    the username (passed as signup metadata) into profiles.
--    security definer = runs with elevated rights so it can write
--    to profiles regardless of the caller.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 5. LOGIN-BY-USERNAME resolver.
--    Supabase logs in by EMAIL. To allow username login without
--    ever exposing emails to the browser, this maps username→email.
--    It's LOCKED to the service_role (our server) — the public/anon
--    client is explicitly denied, so no one can harvest emails.
-- ============================================================
create or replace function public.email_for_username(uname text)
returns text
language sql
security definer
set search_path = ''
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(uname)
  limit 1;
$$;

revoke execute on function public.email_for_username(text) from anon, authenticated, public;
grant  execute on function public.email_for_username(text) to service_role;

-- ============================================================
-- 6. FRIENDSHIPS — mutual friends (request → accept).
--    One row per relationship: the requester sends, the addressee accepts.
--    References profiles(id) so we can embed usernames in queries.
-- ============================================================
create table public.friendships (
  id           bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check  (requester_id <> addressee_id)      -- can't friend yourself
);
create index friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;

-- These are the first RLS policies about a RELATIONSHIP between two users.
create policy "see friendships you're in" on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "send a friend request" on public.friendships for insert
  with check (auth.uid() = requester_id);              -- only as yourself
create policy "respond to requests sent to you" on public.friendships for update
  using (auth.uid() = addressee_id);                   -- only the addressee accepts/declines
create policy "remove your friendships" on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
