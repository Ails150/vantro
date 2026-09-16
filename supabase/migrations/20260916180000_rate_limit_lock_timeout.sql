-- Stop the limiter failing open under exactly the load it exists for.
--
-- 20260916170000 serialised callers on an advisory lock, which made the
-- counting correct. It also made the queue real: thirty simultaneous checks on
-- one key now WAIT for each other. The client aborts at two seconds and the
-- wrapper fails open on abort, so a flood against a single key degrades into no
-- limiting at all -- the limiter working correctly right up until the moment it
-- is needed, which is the worst possible shape for this to fail in.
--
-- The measurement that found it: thirty concurrent checks, three allowed and
-- twenty-seven blocked, but the slowest took 1.64 seconds against a 2 second
-- abort. Against a laptop's round trip, not a flood.
--
-- So the function now refuses to queue for longer than a second and, when it
-- cannot get the lock in that time, REFUSES THE REQUEST rather than allowing
-- it. That inverts the fail-open decision, and only in this one case, on
-- purpose: the lock is per key, and a queue deep enough to take a second at
-- two milliseconds a turn is hundreds of simultaneous requests carrying the
-- same key, which is the definition of the thing being limited. A real
-- worker's token at sixty requests a minute never queues, and a busy site
-- sharing one IP ceiling key is under two requests a second.
--
-- The wrapper still fails OPEN on everything else -- an unreachable database,
-- a missing function, a timeout on the HTTP call -- because a limiter that
-- refuses every request because it cannot reach Postgres has performed the
-- denial of service it was there to prevent.

begin;

create or replace function public.check_rate_limit(
  p_key text,
  p_max_hits integer,
  p_window_seconds integer
)
returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '1000ms'
as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'check_rate_limit: key is required';
  end if;

  begin
    -- One caller at a time per key. Without this the count and the insert are
    -- two statements over one snapshot and concurrent callers all read the
    -- same number -- which is not a theory: twelve concurrent requests got
    -- four through a limit of three.
    perform pg_advisory_xact_lock(hashtext(p_key));
  exception when lock_not_available then
    -- Hundreds of simultaneous requests on one key. Refuse, briefly.
    return query select false, p_max_hits, 2;
    return;
  end;

  select count(*), min(hit_at)
    into v_count, v_oldest
    from public.rate_limit_hits
   where key = p_key
     and hit_at >= v_window_start;

  if v_count >= p_max_hits then
    -- When the oldest hit in the window ages out one slot frees up. That is the
    -- honest Retry-After; the whole window would tell a legitimate caller to
    -- wait far longer than they have to.
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

commit;
