-- The atomic rate limiter was not atomic.
--
-- 20260916160000 moved the count and the insert into one plpgsql function and
-- called the job done. It is not: a function body is not a critical section.
-- Both statements run in one transaction at READ COMMITTED, where the SELECT
-- takes a snapshot and locks nothing, so twelve concurrent callers still read
-- the same count and still proceed. The window narrowed from milliseconds to
-- microseconds, which is the worst kind of fix -- it makes the bug rare enough
-- to look absent and leaves it fully available to the only caller that matters,
-- a script issuing requests in parallel.
--
-- The test that proves this fired twelve concurrent checks at a limit of three
-- and got FOUR through. It had passed twice before that, which is the other
-- lesson: a concurrency test that passes is not evidence, and this one is worth
-- keeping precisely because it is the thing that caught it.
--
-- pg_advisory_xact_lock serialises callers holding the same key, and only the
-- same key. It is taken on hashtext(key), so two different keys can collide and
-- briefly queue behind each other -- harmless, and far cheaper than a table
-- lock or SERIALIZABLE isolation with the retry loop that would need. The lock
-- is released when the transaction ends, which for a single function call is
-- immediately.

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
as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
begin
  if p_key is null or length(p_key) = 0 then
    -- A null key would bucket every caller together and lock out the world the
    -- first time anything hit its limit. Refuse to answer rather than do that.
    raise exception 'check_rate_limit: key is required';
  end if;

  -- THE LINE THAT MAKES THIS A LIMITER. Everything below runs one caller at a
  -- time per key. Without it the count and the insert are two statements over
  -- one snapshot, and concurrent callers all read the same number.
  perform pg_advisory_xact_lock(hashtext(p_key));

  select count(*), min(hit_at)
    into v_count, v_oldest
    from public.rate_limit_hits
   where key = p_key
     and hit_at >= v_window_start;

  if v_count >= p_max_hits then
    -- When the oldest hit in the window ages out, one slot frees up. That is
    -- the honest Retry-After; the whole window length would tell a legitimate
    -- caller to wait far longer than they have to.
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
