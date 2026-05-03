-- Vantro schema dump query
-- Run this in Supabase SQL Editor:
--   1. Copy this whole file
--   2. Paste into SQL Editor: https://supabase.com/dashboard/project/lmobuqxmtkctqqwbspoz/sql
--   3. Run
--   4. Click Export -> CSV
--   5. Save the CSV to docs/schema.csv (overwrite the existing file)
--   6. git add, commit, push
--
-- Re-run weekly, or any time you add/alter a table.

select
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default,
    c.ordinal_position,
    -- Foreign key target if this column has one
    (select string_agg(ccu.table_name || '.' || ccu.column_name, ', ')
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and kcu.table_name = c.table_name
       and kcu.column_name = c.column_name
    ) as fk_references
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name not like 'pg_%'
  and c.table_name not like '_realtime%'
  and c.table_name not like '_supabase%'
order by c.table_name, c.ordinal_position;
