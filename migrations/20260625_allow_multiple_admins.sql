-- 20260625_allow_multiple_admins.sql  -  Vantro
-- Goal: allow a company to have MORE THAN ONE user with role = 'admin'.
--
-- The application layer already supports this (a superadmin can add admins with
-- no count limit). The only thing that could block a second admin is a
-- DB-level uniqueness constraint that lives in Supabase but isn't checked into
-- the repo. This script finds and drops any such constraint/index if present.
--
-- It is SAFE to run whether or not the constraint exists (idempotent), and it
-- deliberately does NOT touch the single-superadmin constraint (the partial
-- unique index on is_superadmin), which is intentional.
--
-- Run once in the Supabase SQL editor.

do $$
declare
  r record;
begin
  -- 1) Partial unique indexes whose predicate restricts the 'admin' ROLE,
  --    e.g.  create unique index ... on users (company_id) where role = 'admin'
  --    (Explicitly excludes anything referencing superadmin / is_superadmin.)
  for r in
    select ci.relname as idxname
    from pg_index i
    join pg_class  ci on ci.oid = i.indexrelid
    join pg_class  ct on ct.oid = i.indrelid
    join pg_namespace n on n.oid = ct.relnamespace
    where n.nspname = 'public'
      and ct.relname = 'users'
      and i.indisunique
      and i.indpred is not null
      and pg_get_expr(i.indpred, i.indrelid) ~* 'role'
      and pg_get_expr(i.indpred, i.indrelid) ~* '''admin'''
      and pg_get_expr(i.indpred, i.indrelid) !~* 'superadmin'
  loop
    execute format('drop index if exists public.%I', r.idxname);
    raise notice 'Dropped admin-limiting unique index: %', r.idxname;
  end loop;

  -- 2) Unique CONSTRAINTS that include the role column, e.g.
  --    unique (company_id, role).  (Excludes superadmin-related ones.)
  for r in
    select con.conname
    from pg_constraint con
    join pg_class  ct on ct.oid = con.conrelid
    join pg_namespace n on n.oid = ct.relnamespace
    where n.nspname = 'public'
      and ct.relname = 'users'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) ~* 'role'
      and pg_get_constraintdef(con.oid) !~* 'superadmin'
  loop
    execute format('alter table public.users drop constraint if exists %I', r.conname);
    raise notice 'Dropped admin-limiting unique constraint: %', r.conname;
  end loop;

  raise notice 'Done. Companies may now have multiple users with role = ''admin''.';
end $$;
