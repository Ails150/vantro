-- Demo data, install tenant
--
-- There was no committed seed in either repo: the Kentford / Kenny demo rows
-- were created directly in Supabase and exist nowhere in version control. This
-- file is the first committed seed, so it can be reviewed, re-run and changed
-- without anyone guessing what the demo is supposed to contain.
--
-- Safe to run more than once. Jobs and checklist items are matched by name and
-- updated in place rather than duplicated.
--
-- BEFORE RUNNING: set v_company_name, and v_installer_email if you want the
-- jobs assigned to someone.
--
-- Old demo rows are NOT deleted. The retirement block at the bottom is opt in,
-- and archives rather than deletes, because this runs against a live database
-- and nobody here can tell junk rows from a real tenant's data by name alone.

do $$
declare
  -- ---- edit these two ------------------------------------------------------
  v_company_name  constant text := 'CHANGE ME';
  v_installer_email constant text := null;  -- e.g. 'installer@example.com', or null to skip assignment
  -- --------------------------------------------------------------------------

  v_company   uuid;
  v_installer uuid;
  v_job       uuid;
  v_tpl       uuid;
  r           record;
begin
  select id into v_company from companies where name = v_company_name limit 1;
  if v_company is null then
    raise exception 'No company named %. Set v_company_name at the top of this file.', v_company_name;
  end if;

  if v_installer_email is not null then
    select id into v_installer
      from users
     where company_id = v_company and lower(email) = lower(v_installer_email)
     limit 1;
    if v_installer is null then
      raise exception 'No user % in company %.', v_installer_email, v_company_name;
    end if;
  end if;

  -- ---- jobs ---------------------------------------------------------------
  -- lat/lng are deliberately left null. signin/route.ts anchors a job with no
  -- coordinates to the first installer who signs in, so the geofence demo works
  -- wherever it is being shown rather than only in Surrey. Set real coordinates
  -- through the admin UI (which geocodes) if you want a fixed site.
  for r in
    select * from (values
      ('Murphy skylight replacement',
       '8 The Green, Guildford, GU1 3UA',              time '08:00', time '12:00'),
      ('Ashcroft House, second fix',
       '14 Ashcroft Rise, Woking, GU21 4TR',           time '11:30', time '15:00'),
      ('Riverside Retail Park, curtain wall survey',
       'Riverside Way, Camberley, GU15 3YL',           time '14:00', time '17:00')
    ) as t(name, address, start_time, sign_out_time)
  loop
    select id into v_job from jobs
     where company_id = v_company and name = r.name limit 1;

    if v_job is null then
      insert into jobs (company_id, name, address, status, start_time, sign_out_time, required_trades)
      values (v_company, r.name, r.address, 'active', r.start_time, r.sign_out_time, '{}')
      returning id into v_job;
    else
      update jobs
         set address        = r.address,
             status         = 'active',
             start_time     = r.start_time,
             sign_out_time  = r.sign_out_time
       where id = v_job;
    end if;

    if v_installer is not null
       and not exists (select 1 from job_assignments
                        where job_id = v_job and user_id = v_installer) then
      insert into job_assignments (company_id, job_id, user_id)
      values (v_company, v_job, v_installer);
    end if;
  end loop;

  -- ---- checklist templates and items --------------------------------------
  -- Labels are written "<ref> - <what to check>" because checklist_items has no
  -- description column. The mobile QA screen splits on the leading reference so
  -- the row is titled by the check and the ref becomes a chip. A label that is
  -- only a code renders as the code, which is what it used to do everywhere.
  --
  -- Two templates, so the QA tab strip actually renders. Eight items on the
  -- first, so the progress bar and the "n left" gate have something to show.

  for r in
    select * from (values
      ('Health and Safety', 'HS 1 - Fire exits kept clear',                          'tick',      true,  false, 1),
      ('Health and Safety', 'HS 2 - Site induction completed and recorded',          'tick',      true,  false, 2),
      ('Health and Safety', 'HS 3 - Working at height permit in place',              'pass_fail', true,  true,  3),
      ('Health and Safety', 'HS 4 - PPE worn by everyone on site',                   'pass_fail', false, false, 4),
      ('Health and Safety', 'HS 5 - Scaffold inspected within the last 7 days',      'pass_fail', true,  true,  5),
      ('Health and Safety', 'HS 6 - Waste and offcuts cleared from walkways',        'tick',      false, false, 6),
      ('Health and Safety', 'HS 7 - First aid kit present and in date',              'tick',      false, false, 7),
      ('Health and Safety', 'HS 8 - Welfare facilities available and clean',         'tick',      false, false, 8),
      ('Fire Safety',       'FS 1 - Extinguishers in date and unobstructed',         'pass_fail', true,  true,  1),
      ('Fire Safety',       'FS 2 - Hot works permit issued where required',         'pass_fail', true,  false, 2),
      ('Fire Safety',       'FS 3 - Escape routes signed and lit',                   'tick',      false, false, 3),
      ('Fire Safety',       'FS 4 - Fire alarm call point tested this week',         'tick',      false, false, 4)
    ) as t(template, label, item_type, is_mandatory, requires_photo, sort_order)
  loop
    select id into v_tpl from checklist_templates
     where company_id = v_company and name = r.template limit 1;

    if v_tpl is null then
      insert into checklist_templates (company_id, name, frequency)
      values (v_company, r.template, 'job')
      returning id into v_tpl;
    end if;

    if exists (select 1 from checklist_items
                where template_id = v_tpl and sort_order = r.sort_order) then
      update checklist_items
         set label          = r.label,
             item_type      = r.item_type,
             is_mandatory   = r.is_mandatory,
             requires_photo = r.requires_photo
       where template_id = v_tpl and sort_order = r.sort_order;
    else
      insert into checklist_items
        (template_id, company_id, label, item_type, is_mandatory,
         requires_photo, requires_video, fail_note_required, sort_order, trade)
      values
        (v_tpl, v_company, r.label, r.item_type, r.is_mandatory,
         r.requires_photo, false, false, r.sort_order, null);
    end if;
  end loop;

  -- ---- attach both templates to all three jobs ----------------------------
  for r in
    select j.id as job_id, t.id as template_id
      from jobs j
      cross join checklist_templates t
     where j.company_id = v_company
       and t.company_id = v_company
       and j.name in ('Murphy skylight replacement',
                      'Ashcroft House, second fix',
                      'Riverside Retail Park, curtain wall survey')
       and t.name in ('Health and Safety', 'Fire Safety')
  loop
    if not exists (select 1 from job_checklists
                    where job_id = r.job_id and template_id = r.template_id) then
      insert into job_checklists (job_id, template_id)
      values (r.job_id, r.template_id);
    end if;
  end loop;

  raise notice 'Demo install data seeded for %.', v_company_name;
end $$;


-- ---- retiring the old demo rows (opt in) -----------------------------------
-- Archives rather than deletes, and names the rows explicitly rather than
-- pattern matching, so it cannot catch a real tenant's job. Check the select
-- first, then run the update.
--
-- select id, name, address, status from jobs
--  where company_id = (select id from companies where name = 'CHANGE ME')
--    and name not in ('Murphy skylight replacement',
--                     'Ashcroft House, second fix',
--                     'Riverside Retail Park, curtain wall survey');
--
-- update jobs set status = 'archived'
--  where company_id = (select id from companies where name = 'CHANGE ME')
--    and name in ('...paste the names you actually want retired...');
