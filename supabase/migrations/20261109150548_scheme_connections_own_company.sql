-- Own company only, superadmin included.
--
-- role = 'superadmin' is held by people inside customer companies, so it must
-- not cross companies here. This table holds a customer's scheme membership.

begin;

drop policy if exists scheme_connections_select on public.scheme_connections;
create policy scheme_connections_select on public.scheme_connections
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
       where u.auth_user_id = auth.uid()
         and u.role = any (array['admin'::text, 'superadmin'::text])
         and u.company_id = public.scheme_connections.company_id
    )
  );

commit;

notify pgrst, 'reload schema';
