-- 20260625_fix_aileen_support_login.sql  -  Vantro
-- Fixes aileen@applyscale8.com being unable to log in.
--
-- Root cause: her users row (id d0e9f02b…) was corrupt test data — it carried
-- her email but name "gez woodhatch", role 'admin' in I-Glaze Limited, and an
-- auth_user_id (2365a7a4…) that actually belongs to getvantro2026@gmail.com.
-- Her real Supabase auth account (94980492…) had NO matching users row, so
-- every login resolved no profile and bounced back to /login.
--
-- This relinks the row to her real auth account and makes it her platform
-- support identity (role 'support', parked on the sentinel company since
-- company_id is NOT NULL; support's effective company comes from the switcher).
--
-- Self-contained: also widens users_role_check to allow 'support' in case
-- 20260625_support_role.sql hasn't been run yet. Run once in the Supabase SQL editor.

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('installer', 'foreman', 'admin', 'superadmin', 'support'));

update public.users
set auth_user_id = '94980492-cd80-473d-aae4-41ea815d2ff2',
    role         = 'support',
    company_id   = '00000000-0000-0000-0000-000000000001',  -- platform sentinel
    name         = 'Aileen O''Doherty'
where id = 'd0e9f02b-1486-4b70-acaf-c99ac854772c';
