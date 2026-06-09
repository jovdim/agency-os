-- 00081_rate_limits.sql
-- Shared, DB-backed fixed-window rate limiter.
--
-- Replaces the per-instance in-memory Map throttle in the per-site /admin login
-- route (src/app/api/platform/auth/login/route.ts). On Vercel the app runs as
-- many independent serverless instances, each with its own memory, so an
-- in-memory counter only sees a fraction of the attempts — an attacker can
-- spread guesses across instances and slip past the cap. A single shared row in
-- Postgres gives every instance the same tally.

create table if not exists public.rate_limit_hits (
  bucket      text        not null,   -- e.g. "site-login:<ip>:<site_id>"
  window_id   bigint      not null,   -- floor(epoch_seconds / window_seconds)
  count       integer     not null default 0,
  expires_at  timestamptz not null,   -- when this window's row may be swept
  primary key (bucket, window_id)
);

create index if not exists rate_limit_hits_expires_idx
  on public.rate_limit_hits (expires_at);

-- Only the service role (via the SECURITY DEFINER function below) ever touches
-- this table. RLS-on with no policy denies anon/authenticated; we do NOT FORCE
-- it, so the function's definer (table owner) can still write.
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Atomic fixed-window increment. Bumps the current window's counter in a single
-- statement (race-safe across instances) and reports whether the caller is now
-- OVER the limit. SECURITY DEFINER so it can write irrespective of RLS.
create or replace function public.rate_limit_touch(
  p_key             text,
  p_window_seconds  integer,
  p_max             integer
)
returns table (blocked boolean, current_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window bigint;
  v_count  integer;
begin
  v_window := floor(extract(epoch from now()) / p_window_seconds)::bigint;

  insert into public.rate_limit_hits as r (bucket, window_id, count, expires_at)
  values (p_key, v_window, 1, to_timestamp((v_window + 1) * p_window_seconds))
  on conflict (bucket, window_id)
    do update set count = r.count + 1
  returning r.count into v_count;

  -- Opportunistic cleanup: drop this key's older windows so the table stays
  -- small without needing a scheduled job for the common case.
  delete from public.rate_limit_hits
  where bucket = p_key and window_id < v_window;

  return query select (v_count > p_max), v_count;
end;
$$;

-- Lock the function down to the service role (the server-side admin client).
revoke all on function public.rate_limit_touch(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_touch(text, integer, integer)
  to service_role;
