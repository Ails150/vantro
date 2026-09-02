-- 20260902_companies_vertical.sql  -  Vantro
-- companies.vertical: which industry a company is in.
--
-- Vantro is one product serving install, cleaning, security, grounds and pest.
-- Until now the app assumed construction everywhere: the wizard, the tab list
-- and every noun in the UI. This column is the single stored fact the whole
-- vertical layer branches on. lib/vertical.ts reads it and nothing else
-- decides per-industry behaviour.
--
-- ROW COUNTS BEFORE (live, 2026-09-02):
--   companies                          12
--   companies.vertical                  0  (column does not exist yet)
--
-- All 12 existing rows take the 'install' default, so nothing changes for
-- anyone already on the product. Postgres 11+ fills the default in place,
-- so there is no table rewrite and no lock worth planning around.
--
-- ORDER OF DEPLOY. This one is safe in either order: the column is additive
-- and the code that reads it treats a missing or unknown value as 'install'.
-- Run it before the wizard step ships, so the first company to pick a
-- vertical has somewhere to store the answer.
--
-- Rolling back is `alter table public.companies drop column vertical;`.
-- Nothing references it until lib/vertical.ts lands.

begin;

alter table public.companies
  add column if not exists vertical text not null default 'install';

-- The five verticals from VANTRO-ADMIN-V1.md section 3.1. Constrained rather
-- than left free text so a typo in a wizard payload fails at the write
-- instead of silently producing a company that matches no config and falls
-- back to install forever.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_vertical_check'
  ) then
    alter table public.companies
      add constraint companies_vertical_check
      check (vertical in ('install', 'cleaning', 'security', 'grounds', 'pest'));
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- Verify: 12 rows, all 'install'.
--   select vertical, count(*) from companies group by vertical order by 2 desc;
--
-- And the constraint should reject anything else:
--   update companies set vertical = 'nope' where false;  -- parses, no-op
--   -- a real bad write raises: new row violates check constraint
--   --   "companies_vertical_check"
