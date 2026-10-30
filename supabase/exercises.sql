-- ChordRush: user-created exercises (Create tab) with a hard per-account cap.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The cap is enforced HERE (a trigger), not in the browser, so it applies to every
-- account including the owner. The only way around it is changing this function.

create table if not exists public.exercises (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Untitled exercise' check (char_length(title) between 1 and 80),
  spec       jsonb not null default '{}'::jsonb,       -- the exercise definition (shape TBD)
  created_at timestamptz not null default now()
);

create index if not exists exercises_user_idx on public.exercises (user_id, created_at);

-- Visibility: private by default. Public exercises are readable by everyone (see the read-public policy below).
alter table public.exercises add column if not exists is_public boolean not null default false;

-- Row-level security: each person can see and change only their own exercises.
-- The one exception: anyone can READ exercises their owner has marked public. Only owners can change or delete.
alter table public.exercises enable row level security;

drop policy if exists "exercises: read own"    on public.exercises;
drop policy if exists "exercises: read public" on public.exercises;
drop policy if exists "exercises: insert own"  on public.exercises;
drop policy if exists "exercises: update own"  on public.exercises;
drop policy if exists "exercises: delete own"  on public.exercises;

create policy "exercises: read own"    on public.exercises for select using (auth.uid() = user_id);
create policy "exercises: read public" on public.exercises for select using (is_public);
create policy "exercises: insert own" on public.exercises for insert with check (auth.uid() = user_id);
create policy "exercises: update own" on public.exercises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exercises: delete own" on public.exercises for delete using (auth.uid() = user_id);

-- The cap: max 5 exercises per account. The advisory lock serializes a person's inserts so two
-- tabs saving at the same moment can't both slip past the count.
create or replace function public.enforce_exercise_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if (select count(*) from public.exercises where user_id = new.user_id) >= 5 then
    raise exception 'exercise limit reached (5 per account)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists exercises_cap on public.exercises;
create trigger exercises_cap
  before insert on public.exercises
  for each row execute function public.enforce_exercise_cap();
