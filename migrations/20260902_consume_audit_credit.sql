-- 20260902_consume_audit_credit.sql  -  Vantro
-- consume_audit_credit(): spend one audit pack credit, atomically, or raise.
--
-- Called by the /api/audit/v2 generate route before any work is done. Returns
-- the company's remaining balance, or NULL when the company is not metered
-- (audit_billing = 'included' -- the £79/mo subscription customers, who are
-- not touched by any of this).
--
-- Raises SQLSTATE 'VC402' with message 'insufficient_audit_credits' when a
-- PAYG company has nothing left. The route maps exactly that code to HTTP 402
-- plus a checkout URL. A custom code rather than string matching, so a
-- reworded message can never turn a payment prompt into a 500.
--
-- SIGNATURE NOTE. The original sketch was
--   consume_audit_credit(company_id, pack_id, view, user_id)
-- but pack_id is now a fresh uuid minted per generate call, so it cannot
-- identify a repeat. What makes two generates the same purchase is the job,
-- the period and the view, so those are parameters and pack_id is carried
-- through as the identity of this particular pack.
--
-- Depends on 20260902_audit_credits.sql.

begin;

create or replace function public.consume_audit_credit(
  p_company_id  uuid,
  p_pack_id     uuid,
  p_job_id      uuid,
  p_period_from date,
  p_period_to   date,
  p_view        text,
  p_user_id     uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_billing text;
  v_balance integer;
  v_already boolean := false;
begin
  -- ---- Input shape -------------------------------------------------------
  if p_company_id is null or p_pack_id is null or p_job_id is null then
    raise exception 'company_id, pack_id and job_id are required'
      using errcode = '22023';
  end if;

  if p_view is null or p_view not in ('internal', 'client', 'external') then
    raise exception 'invalid view: %', coalesce(p_view, 'null')
      using errcode = '22023';
  end if;

  -- ---- Is this company metered at all? -----------------------------------
  select audit_billing into v_billing
    from companies
   where id = p_company_id;

  if not found then
    raise exception 'company % not found', p_company_id
      using errcode = '23503';
  end if;

  -- Subscription customers generate freely. Nothing is spent and nothing is
  -- written, so the ledger stays a record of real money only.
  if v_billing is distinct from 'payg' then
    return null;
  end if;

  -- ---- Already paid for this exact pack? ---------------------------------
  -- This has to come BEFORE the balance check. A company that bought a pack,
  -- spent its last credit on it, and then refreshes the page must get the
  -- pack it paid for -- not a 402 because the balance is now zero.
  --
  -- The coalesce sentinels mirror audit_credit_ledger_consume_uniq exactly.
  -- If these two ever disagree, a repeat generate double-charges, so they are
  -- deliberately written the same way.
  select true into v_already
    from audit_credit_ledger
   where reason = 'consume'
     and company_id = p_company_id
     and job_id = p_job_id
     and coalesce(period_from, '-infinity'::date) = coalesce(p_period_from, '-infinity'::date)
     and coalesce(period_to,   'infinity'::date)  = coalesce(p_period_to,   'infinity'::date)
     and view = p_view
   limit 1;

  if v_already then
    select balance into v_balance from audit_credits where company_id = p_company_id;
    return coalesce(v_balance, 0);
  end if;

  -- ---- Spend one --------------------------------------------------------
  -- FOR UPDATE serialises concurrent generates for this company. Two admins
  -- hitting generate at once queue here rather than both reading balance = 1
  -- and both spending it.
  select balance into v_balance
    from audit_credits
   where company_id = p_company_id
     for update;

  -- No row means the company has never bought credits. Same outcome as zero.
  if not found or v_balance < 1 then
    raise exception 'insufficient_audit_credits'
      using errcode = 'VC402',
            detail  = format('company %s has %s credits', p_company_id, coalesce(v_balance, 0)),
            hint    = 'Buy an audit pack credit to generate this report.';
  end if;

  update audit_credits
     set balance    = balance - 1,
         updated_at = now()
   where company_id = p_company_id
   returning balance into v_balance;

  insert into audit_credit_ledger (
    company_id, delta, reason, balance_after,
    pack_id, job_id, period_from, period_to, view, user_id
  ) values (
    p_company_id, -1, 'consume', v_balance,
    p_pack_id, p_job_id, p_period_from, p_period_to, p_view, p_user_id
  );

  return v_balance;

exception
  -- Two generates for the same job/period/view raced past the check above.
  -- The unique index caught the loser. plpgsql rolls the whole block back --
  -- the UPDATE included -- so the balance is not decremented twice. Report
  -- the pack as paid for, because it is.
  when unique_violation then
    select balance into v_balance from audit_credits where company_id = p_company_id;
    return coalesce(v_balance, 0);
end;
$$;

-- Server routes hold the service role, which is the only caller. Nothing
-- reached with a user's own JWT should be able to move a balance.
revoke all on function public.consume_audit_credit(uuid, uuid, uuid, date, date, text, uuid) from public;
revoke all on function public.consume_audit_credit(uuid, uuid, uuid, date, date, text, uuid) from anon;
revoke all on function public.consume_audit_credit(uuid, uuid, uuid, date, date, text, uuid) from authenticated;
grant execute on function public.consume_audit_credit(uuid, uuid, uuid, date, date, text, uuid) to service_role;

commit;

notify pgrst, 'reload schema';

-- Verify (safe, rolls back):
--   begin;
--     update companies set audit_billing = 'payg' where id = '<co>';
--     insert into audit_credits (company_id, balance) values ('<co>', 2)
--       on conflict (company_id) do update set balance = 2;
--     select consume_audit_credit('<co>', gen_random_uuid(), '<job>', null, null, 'internal', null); -- 1
--     select consume_audit_credit('<co>', gen_random_uuid(), '<job>', null, null, 'internal', null); -- 1, no double charge
--     select consume_audit_credit('<co>', gen_random_uuid(), '<job>', null, null, 'client',   null); -- 0, different view
--     select consume_audit_credit('<co>', gen_random_uuid(), '<job>', null, null, 'external', null); -- raises VC402
--   rollback;
