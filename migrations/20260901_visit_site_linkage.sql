-- Link a visit to a site, and a shift to a visit
--
-- Two columns the multi-site work cannot proceed without:
--
--   job_visits.site_id  -- a visit currently cannot point at a site at all
--   signins.visit_id    -- a shift attaches to a job, so two visits to the same
--                          site on one day collapse into one bucket and the
--                          audit pack cannot say who was there for which
--
-- Both are nullable. Nothing is made required here: the existing job-centric
-- paths keep working untouched, and the columns fill in as write paths land.
--
-- STATE OF THE DATA AT THE TIME OF WRITING (counted against live, 2026-09-01):
--   sites                                0 rows
--   jobs                                23 rows, 0 with site_id set
--   job_visits                          22 rows
--   visit_assignments                   17 rows, 0 with start_at set
--   signins                            223 rows
--
-- That shapes the backfills below. The job_visits.site_id backfill is a no-op
-- today because there are no sites to point at; it is written anyway so it
-- does the right thing whenever it is re-run after sites exist. The
-- signins.visit_id backfill has real work to do.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table job_visits add column if not exists site_id uuid references sites(id);
alter table signins    add column if not exists visit_id uuid references job_visits(id);

create index if not exists job_visits_site_idx on job_visits (site_id) where site_id is not null;
create index if not exists signins_visit_idx   on signins (visit_id)  where visit_id is not null;


-- ---------------------------------------------------------------------------
-- Backfill 1: job_visits.site_id, from the job's own site
--
-- jobs.site_id already exists (it predates this file) but no code writes it,
-- so it is null on every row today and this updates nothing. Re-run it after
-- jobs start carrying a site.
-- ---------------------------------------------------------------------------
update job_visits v
   set site_id = j.site_id
  from jobs j
 where j.id = v.job_id
   and j.site_id is not null
   and v.site_id is null;


-- ---------------------------------------------------------------------------
-- Backfill 2: signins.visit_id, from the visit the shift falls inside
--
-- A shift belongs to a visit when it is on that visit's job and started inside
-- the visit's window. Where two visits could claim the same shift, it is left
-- null: a null visit_id means "not known", which is honest, whereas guessing
-- puts a person at the wrong visit in an audit pack.
--
-- This deliberately does NOT require a matching visit_assignment. Only 17
-- assignment rows exist against 22 visits, so requiring one would leave almost
-- everything null while telling us nothing about whether the shift happened.
-- ---------------------------------------------------------------------------
with candidate as (
  select s.id                              as signin_id,
         v.id                              as visit_id,
         count(*) over (partition by s.id) as matches
    from signins s
    join job_visits v
      on  v.job_id     = s.job_id
      and v.company_id = s.company_id
      and s.signed_in_at >= v.start_at
      and s.signed_in_at <  coalesce(v.end_at, v.start_at + interval '1 day')
   where s.visit_id is null
     and s.signed_in_at is not null
)
update signins s
   set visit_id = c.visit_id
  from candidate c
 where c.signin_id = s.id
   and c.matches = 1;


-- ---------------------------------------------------------------------------
-- What landed
-- ---------------------------------------------------------------------------
do $$
declare
  v_visits_linked  int;
  v_signins_linked int;
  v_signins_total  int;
begin
  select count(*) into v_visits_linked  from job_visits where site_id is not null;
  select count(*) into v_signins_linked from signins    where visit_id is not null;
  select count(*) into v_signins_total  from signins;
  raise notice 'job_visits with a site: %', v_visits_linked;
  raise notice 'signins with a visit: % of %', v_signins_linked, v_signins_total;
end $$;
