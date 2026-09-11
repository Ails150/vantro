-- Make the Xero week index usable by ON CONFLICT.
--
-- 20260911090000 created this index PARTIAL (`where xero_week_start is not
-- null`), reasoning that the older CSV exports carry no week and should stay
-- as numerous as they like. That part was right, but a partial index cannot be
-- inferred by `on conflict (company_id, xero_week_start)`: Postgres requires
-- the inference to restate the index predicate, and PostgREST's upsert has no
-- way to express one. The route failed with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" -- so the idempotency the
-- index existed to guarantee was never actually enforced.
--
-- A plain unique index does both jobs. Postgres treats NULLs as DISTINCT by
-- default, so every CSV export (xero_week_start null) is still free to
-- coexist, while two Xero exports of the same company and week collide exactly
-- as intended.

drop index if exists payroll_exports_company_xero_week_idx;

create unique index if not exists payroll_exports_company_xero_week_idx
  on payroll_exports (company_id, xero_week_start);

comment on index payroll_exports_company_xero_week_idx is
  'One Xero timesheet per company per week. NULL xero_week_start (plain CSV exports) are distinct under default NULLS DISTINCT, so those stay unconstrained.';
