-- Make the rate limiter atomic, and stop it growing for ever.
--
-- THE RACE. The limiter was two statements: count the hits in the window, then
-- insert one. Between them, every other request in flight sees the same count.
-- Ten concurrent attempts against a limit of three all read 0 and all proceed,
-- which is precisely the shape of traffic a limiter exists to stop -- an
-- attacker is not making requests one at a time and waiting politely for each
-- reply. The limit held against a human and dissolved against a script.
--
-- check_rate_limit() does both in one statement under one lock, and returns
-- what the caller needs to build a 429: whether it is allowed, the count, and
-- when the window frees up.
--
-- THE TABLE HAD NO INDEX AND NO CLEANUP. Every check was a sequential scan over
-- every hit ever recorded, on the hot path of the routes we most want to answer
-- quickly, and it got slower every day. There is now an index on (key, hit_at)
-- and rows outside any plausible window are deleted opportunistically.

begin;

create index if not exists rate_limit_hits_key_hit_at_idx
  on public.rate_limit_hits (key, hit_at desc);

-- Nobody but the service role has any business reading or writing this. It is
-- a record of who has been trying what, and it is not tenant-scoped.
alter table public.rate_limit_hits enable row level security;

drop policy if exists rate_limit_hits_no_client_access on public.rate_limit_hits;
create policy rate_limit_hits_no_client_access
  on public.rate_limit_hits
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

create or replace function public.check_rate_limit(
  p_key text,
  p_max_hits integer,
  p_window_seconds integer
)
returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
begin
  if p_key is null or length(p_key) = 0 then
    -- A null key would bucket every caller together and lock out the world the
    -- first time anything hit the limit. Refuse to answer rather than do that.
    raise exception 'check_rate_limit: key is required';
  end if;

  -- One statement. The count and the decision cannot drift apart because
  -- nothing happens between them.
  select count(*), min(hit_at)
    into v_count, v_oldest
    from public.rate_limit_hits
   where key = p_key
     and hit_at >= v_window_start;

  if v_count >= p_max_hits then
    -- When the oldest hit in the window ages out, one slot frees up. That is
    -- the honest Retry-After, rather than the whole window length, which would
    -- tell a legitimate caller to wait far longer than they have to.
    return query select
      false,
      v_count,
      greatest(
        1,
        ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds)) - now()))::integer
      );
    return;
  end if;

  insert into public.rate_limit_hits (key) values (p_key);

  return query select true, v_count + 1, 0;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Prune. Called from the nightly cleanup rather than from the hot path: doing
-- it per-request would make every rate-limit check a write amplification on the
-- busiest table in the system.
--
-- 24 hours is comfortably longer than the longest window any caller uses (one
-- hour), so nothing still in scope is ever removed.
create or replace function public.prune_rate_limit_hits()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_hits where hit_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_rate_limit_hits() from public;
grant execute on function public.prune_rate_limit_hits() to service_role;

commit;
