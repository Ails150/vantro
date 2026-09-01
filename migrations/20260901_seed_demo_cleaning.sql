-- Demo data, cleaning tenant
--
-- PARTIAL BY NECESSITY. The build brief asks for three sites with recurring
-- schedules and crew sizes:
--
--   Fairfield Primary School        Weekdays 06:00 to 09:00   crew 3
--   Northgate Business Park, Block C  Mon, Wed, Fri 18:00 to 21:00  crew 2
--   Riverside Medical Centre        Daily 19:00 to 21:00      crew 2
--
-- Only the sites can be seeded today. The schedule and the crew have nowhere
-- to go:
--
--   * There is no visit_schedules table, no rrule column and no materialising
--     cron. Visits are created one at a time by an admin on the calendar
--     (app/api/admin/visit-assignments/route.ts finds or creates a single day
--     job_visits row). Recurrence is section C3 and is not built.
--   * job_visits has no site_id, so a visit cannot point at a site at all. It
--     hangs off a job_id.
--   * Nothing carries a crew size. visit_assignments already holds many users
--     per visit, which is the mechanism, but the establishment figure has no
--     column.
--
-- So this file seeds the three sites and stops. The schedule and crew columns
-- are recorded in notes so the intent is not lost, and so this file can be
-- extended in place once C3 and C4 land rather than rewritten.
--
-- Safe to run more than once. Sites are matched by name within the company.

do $$
declare
  -- ---- edit this -----------------------------------------------------------
  v_company_name constant text := 'CHANGE ME';
  -- --------------------------------------------------------------------------

  v_company uuid;
  v_site    uuid;
  r         record;
begin
  select id into v_company from companies where name = v_company_name limit 1;
  if v_company is null then
    raise exception 'No company named %. Set v_company_name at the top of this file.', v_company_name;
  end if;

  for r in
    select * from (values
      ('Fairfield Primary School',
       'Fairfield Road, Guildford',
       'GU1 4AJ',
       'Surrey County Council',
       'Weekdays 06:00 to 09:00, crew of 3. Term time only, no access during half term.'),
      ('Northgate Business Park, Block C',
       'Northgate Way, Woking',
       'GU21 5RX',
       'Northgate Estates',
       'Mon, Wed, Fri 18:00 to 21:00, crew of 2. Barrier code needed after 18:00.'),
      ('Riverside Medical Centre',
       'Riverside Way, Camberley',
       'GU15 3YL',
       'Riverside Health Partnership',
       'Daily 19:00 to 21:00, crew of 2. Clinical waste handled by the practice, not by us.')
    ) as t(name, address, postcode, client_name, notes)
  loop
    select id into v_site from sites
     where company_id = v_company and name = r.name limit 1;

    if v_site is null then
      -- lat/lng are left null: the admin create path geocodes through Google
      -- Maps, and there is no key available from a SQL editor. Open each site
      -- in the admin UI and save it once to fill the coordinates in.
      insert into sites (company_id, name, address, postcode, client_name, notes, is_active)
      values (v_company, r.name, r.address, r.postcode, r.client_name, r.notes, true);
    else
      update sites
         set address     = r.address,
             postcode    = r.postcode,
             client_name = r.client_name,
             notes       = r.notes,
             is_active   = true,
             updated_at  = now()
       where id = v_site;
    end if;
  end loop;

  raise notice 'Cleaning demo sites seeded for %. Schedules and crews need C3 and C4.', v_company_name;
end $$;

-- Note for whoever wires the admin UI: SitesTab is written and rendered at
-- components/admin/AdminDashboard.tsx:2593, but neither setupTabs (:1122) nor
-- operationsTabs (:1134) has a sites entry, so there is no way to open it.
-- These rows will not be visible in the admin app until that entry is added.
