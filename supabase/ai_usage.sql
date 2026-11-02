-- ChordRush: AI usage accounting for the natural-language exercise generator.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- A generation is RESERVED before the model is called (so parallel requests can't overshoot the limit), tokens are
-- recorded afterwards, and a failed call is refunded. Limits themselves live in the Worker (src/generate-exercise.js)
-- and are passed in, so changing a limit never needs a migration.
--
-- SECURITY: the browser must never be able to write these tables or call these functions, or someone could reset
-- their own usage. Tables have RLS with no write policies; the functions are executable by the service role only.

create table if not exists public.ai_usage (
  user_id       uuid   not null references auth.users(id) on delete cascade,
  day           date   not null,                      -- UTC day
  requests      int    not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

create table if not exists public.ai_usage_global (
  day           date   primary key,
  requests      int    not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0
);

alter table public.ai_usage        enable row level security;
alter table public.ai_usage_global enable row level security;

-- people may READ their own row (so the editor can show "n left today"); nobody but the service role can write.
-- The global table has no policies at all, so it is invisible to the browser.
drop policy if exists "ai_usage: read own" on public.ai_usage;
create policy "ai_usage: read own" on public.ai_usage for select using (auth.uid() = user_id);

-- Reserve one generation. Locks the global row, then the user's row (always in that order), so concurrent callers queue up.
create or replace function public.ai_reserve(p_user uuid, p_user_limit int, p_global_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'utc')::date;
  g int;
  u int;
begin
  insert into public.ai_usage_global(day) values (d) on conflict do nothing;
  insert into public.ai_usage(user_id, day) values (p_user, d) on conflict do nothing;
  select requests into g from public.ai_usage_global where day = d for update;
  select requests into u from public.ai_usage where user_id = p_user and day = d for update;

  if g >= p_global_limit then
    return jsonb_build_object('ok', false, 'reason', 'global', 'user_used', u);
  end if;
  if u >= p_user_limit then
    return jsonb_build_object('ok', false, 'reason', 'user', 'user_used', u);
  end if;

  update public.ai_usage_global set requests = requests + 1 where day = d;
  update public.ai_usage set requests = requests + 1 where user_id = p_user and day = d;
  return jsonb_build_object('ok', true, 'user_used', u + 1);
end;
$$;

-- After the call: add the tokens used, or (p_refund) give the reservation back because the call itself failed.
create or replace function public.ai_settle(p_user uuid, p_input bigint, p_output bigint, p_refund boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'utc')::date;
begin
  if p_refund then
    update public.ai_usage set requests = greatest(requests - 1, 0) where user_id = p_user and day = d;
    update public.ai_usage_global set requests = greatest(requests - 1, 0) where day = d;
  else
    update public.ai_usage
       set input_tokens = input_tokens + greatest(p_input, 0), output_tokens = output_tokens + greatest(p_output, 0)
     where user_id = p_user and day = d;
    update public.ai_usage_global
       set input_tokens = input_tokens + greatest(p_input, 0), output_tokens = output_tokens + greatest(p_output, 0)
     where day = d;
  end if;
end;
$$;

-- Postgres grants EXECUTE to everyone by default; take it away so only the server (service role) can call these.
revoke all on function public.ai_reserve(uuid, int, int)            from public, anon, authenticated;
revoke all on function public.ai_settle(uuid, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, int, int)            to service_role;
grant execute on function public.ai_settle(uuid, bigint, bigint, boolean) to service_role;
