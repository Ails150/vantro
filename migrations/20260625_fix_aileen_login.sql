-- 20260625_fix_aileen_login.sql  -  Vantro
-- Fixes aileen@applyscale8.com being unable to log in (flash /admin -> /login).
--
-- Root cause: her users row (id d0e9f02b…) was corrupt — it carried her email
-- but name "gez woodhatch", role 'admin' in I-Glaze, and an auth_user_id
-- (2365a7a4…) belonging to getvantro2026@gmail.com. Her real auth account
-- (94980492…) had no matching users row, so login resolved no profile and
-- bounced to /login.
--
-- Fix: make this row her real admin identity on her own company (Apexify),
-- linked to her real auth account. Already applied in production via the
-- service role; this file records it and is idempotent. Run in Supabase if
-- re-applying.

update public.users
set role         = 'admin',
    company_id   = '00695d96-0465-4f38-8d0a-2e494063b908',  -- Apexify Agency
    auth_user_id = '94980492-cd80-473d-aae4-41ea815d2ff2',
    name         = 'Aileen O''Doherty'
where id = 'd0e9f02b-1486-4b70-acaf-c99ac854772c';
