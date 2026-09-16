-- 20260916140000_evidence_no_client_writes.sql  -  Vantro
--
-- No browser session may UPDATE or DELETE an evidence row. Ever.
--
-- FOUND BY THE SECURITY PASS, section D16. RLS on the evidential tables allowed
-- any authenticated member of a company to write to them directly through
-- PostgREST, with the public anon key and their own session, bypassing every
-- check in the route layer. A foreman could rewrite an attendance record from
-- the browser console.
--
-- It was load bearing rather than an oversight: AdminDashboard closed every
-- open shift on a finished job with a direct `supabase.from("signins").update`.
-- That write moved to POST /api/admin/jobs/sign-out-all in the same commit as
-- this migration, which is what makes tightening possible at all.
--
-- RESTRICTIVE, NOT A REPLACEMENT FOR WHAT IS THERE.
--
-- The existing policies on these tables were created outside migrations and are
-- not reproduced here, so dropping and rewriting them would mean guessing their
-- predicates and risking every READ in the product. A RESTRICTIVE policy ANDs
-- with whatever permissive policies exist: it can only ever take permission
-- away, never grant it, and it cannot break a SELECT or an INSERT because it
-- names neither. That makes this safe to apply without first knowing what is
-- already in place -- which, with no Docker available to dump the schema, is
-- the difference between doing this now and not doing it.
--
-- THE SERVER IS UNAFFECTED. service_role carries BYPASSRLS, so every route
-- using createServiceClient keeps working exactly as before. That is the whole
-- shape of the fix: writes go through code that checks who is asking, and the
-- database refuses everyone else.
--
-- evidence_hashes gets the same treatment for DELETE, which restricts deletion
-- to the tenant-deletion route. A trigger would have been wrong there: it would
-- block the service role too, and Article 17 deletion has to be able to remove
-- these rows. UPDATE on that table is already refused outright by
-- 20260916130000, for everyone including the server, because there is no
-- legitimate edit to a hash.

begin;

do $$
declare
  t text;
  evidence_tables text[] := array[
    'signins',
    'location_logs',
    'diary_entries',
    'qa_submissions',
    'defects',
    'variations',
    'walkthroughs',
    'walkthrough_clips',
    'incidents',
    'rams_documents',
    'rams_signatures',
    'toolbox_talks',
    'toolbox_talk_signatures',
    'expenses',
    'audit_packs',
    'evidence_hashes'
  ];
begin
  foreach t in array evidence_tables loop
    -- Skip a table that does not exist rather than failing the migration: the
    -- list is maintained by hand and a rename must not take the whole thing
    -- down with it.
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skipping %, not present', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_no_client_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated, anon using (false)',
      t || '_no_client_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_no_client_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated, anon using (false)',
      t || '_no_client_delete', t
    );

    raise notice 'locked client writes on %', t;
  end loop;
end $$;

comment on table public.evidence_hashes is
  'Append-only hash ledger. UPDATE refused for everyone including service_role (20260916130000). DELETE refused for client sessions; permitted to service_role so the tenant-deletion route can satisfy Article 17.';

commit;
