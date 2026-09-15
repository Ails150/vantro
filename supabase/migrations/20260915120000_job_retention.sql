-- 20260915120000_job_retention.sql  -  Vantro
--
-- Retention: the slice of a contract the client keeps hold of after the work is
-- finished, released once the defects period has run out.
--
-- This is the money a subcontractor is most likely to lose, and it is lost the
-- same way every time: nobody is watching the calendar. Retention on a job that
-- finished eighteen months ago is somebody else's cash until a letter is
-- written asking for it, and the letter never gets written because the job is
-- off everyone's desk. The whole feature is a date, a figure, and a nudge
-- thirty days before the date.
--
-- FIVE COLUMNS ON jobs, NOT A TABLE
-- Every one of these is a single fact about one job, with no history and no
-- second row ever needed. A job_retention table would be a one-to-one join
-- carrying nothing, and every read of the money list would pay for it. If
-- staged releases are ever modelled (see the moiety note below) that judgement
-- gets revisited, and that is the point at which a table earns its place.
--
--   contract_value            ALREADY EXISTS. Not added here, not redefined.
--   retention_percent         what the contract says is held back, e.g. 5.00
--   practical_completion_date when the clock starts
--   defects_period_months     how long the client keeps it after PC
--   retention_released_at     when it actually came back, or null
--
-- WHAT IS DELIBERATELY NOT MODELLED
-- UK construction usually releases retention in two moieties: half at practical
-- completion, half at the end of the defects liability period. This schema
-- holds ONE claim date, which is the end of the defects period. That is the
-- larger and later half, and it is the one that actually goes missing -- the
-- first moiety tends to be settled inside the final account while the job is
-- still warm. Modelling both would need two dates and two released-at stamps,
-- and would double the card and the list for a claim most users chase anyway.
-- Stated here so the gap is a decision on record rather than an oversight.
--
-- NO EVIDENCE HASH
-- public.jobs carries no record_evidence_hash trigger and this migration does
-- not add one. Retention is commercial, not site evidence: these figures are
-- what the contract says, and they are meant to be corrected when the contract
-- is renegotiated. The retention claim letter CITES the job's audit pack
-- reference, so the evidence behind the claim is hashed and signed in the place
-- that already does that properly. Hashing the asking price would confuse a
-- commercial record with an evidential one.

begin;

alter table public.jobs
  -- numeric, not float: this multiplies a contract value and the answer is
  -- printed on a letter asking for money. Binary floating point has no business
  -- anywhere near it. 5.25% is expressible; a percentage beyond two decimals is
  -- not a thing any contract writes.
  add column if not exists retention_percent numeric(5,2),

  -- date, not timestamptz. Practical completion is a contractual day named in a
  -- certificate, not an instant, and storing it with a zone would let a job
  -- signed off in London read as the previous day to anyone east of us.
  add column if not exists practical_completion_date date,

  -- The defects liability period. Twelve months is the common case; six and
  -- twenty-four both turn up. No default: guessing this number invents a claim
  -- date, and a wrong claim date is worse than an absent one because it looks
  -- like an answer.
  add column if not exists defects_period_months integer,

  -- When the money actually arrived. Null means still held, and this is the
  -- ONLY thing that takes a job off the money list -- not the date passing, not
  -- the job being archived. A claim that came due and was never paid must stay
  -- visible, because that is precisely the case the feature exists for.
  add column if not exists retention_released_at timestamptz,

  -- Who marked it released. An amount of money leaving the outstanding column
  -- should have a name against it.
  add column if not exists retention_released_by uuid references public.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Constraints: refuse the values that would produce a nonsense letter
-- ---------------------------------------------------------------------------

-- A percentage outside 0-100 is a typo every time -- most often 50 meant as
-- 5.0. Caught here as well as in the route, because the CSV importer and any
-- future integration write to this table too.
alter table public.jobs
  drop constraint if exists jobs_retention_percent_range;
alter table public.jobs
  add constraint jobs_retention_percent_range
  check (retention_percent is null or (retention_percent >= 0 and retention_percent <= 100));

-- Zero months is legitimate (retention released at practical completion, no
-- defects period). Negative is not, and neither is a period so long it is
-- certainly a typo for months-vs-years: ten years exceeds the limitation period
-- on a contract under seal.
alter table public.jobs
  drop constraint if exists jobs_defects_period_months_range;
alter table public.jobs
  add constraint jobs_defects_period_months_range
  check (defects_period_months is null or (defects_period_months >= 0 and defects_period_months <= 120));

-- Retention cannot be released before the work was finished. This catches the
-- date-entry slip where a year is typed wrong, which would otherwise quietly
-- settle a claim that is still outstanding.
alter table public.jobs
  drop constraint if exists jobs_retention_released_after_pc;
alter table public.jobs
  add constraint jobs_retention_released_after_pc
  check (
    retention_released_at is null
    or practical_completion_date is null
    or retention_released_at >= practical_completion_date::timestamptz
  );

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------
-- The money list asks one question: which jobs on this company still have
-- retention outstanding. Partial on "not released", because released jobs are
-- the ones that accumulate forever and are never in the answer.
create index if not exists jobs_retention_outstanding_idx
  on public.jobs (company_id, practical_completion_date)
  where retention_released_at is null and retention_percent is not null;

comment on column public.jobs.retention_percent is
  'Percentage of contract_value held back by the client. Null means this job has no retention.';
comment on column public.jobs.practical_completion_date is
  'Contractual date of practical completion. The defects period runs from here.';
comment on column public.jobs.defects_period_months is
  'Defects liability period in months. claim due date = practical_completion_date + this.';
comment on column public.jobs.retention_released_at is
  'When retention was actually released. Null means still outstanding, regardless of the claim date having passed.';

commit;
