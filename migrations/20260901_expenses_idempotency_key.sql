-- Duplicate expense submissions
--
-- The same receipt could be submitted twice (a double tap, a retry after a
-- flaky upload) and land as two rows: the demo tenant showed the same
-- £859.14 Materials at 08:33 and again at 08:48.
--
-- The key is sha256(receipt bytes) + amount + job id, computed in
-- app/api/expenses/route.ts. A partial unique index enforces it while
-- leaving pre-existing rows (key null) alone.

alter table expenses add column if not exists idempotency_key text;

create unique index if not exists expenses_idempotency_key_idx
  on expenses (idempotency_key)
  where idempotency_key is not null;
