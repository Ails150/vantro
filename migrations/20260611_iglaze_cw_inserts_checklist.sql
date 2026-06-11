-- =============================================================================
-- I-Glaze Limited — new QA checklist template
-- Template: "Installation Checklist – Curtain Wall (w/ inserts)"
-- Company:  I-Glaze Limited (e43b6e11-8c49-448b-976b-260f5ddfbbdd)  [VERIFIED, not hardcoded blindly]
-- Date:     2026-06-11
--
-- Scope guard: touches ONLY I-Glaze data. Does NOT modify any existing template
-- or any Apexify Agency (00695d96-0465-4f38-8d0a-2e494063b908) data.
--
-- Schema notes (verified against live rows):
--   * checklist_items has NO `description` column  -> descriptions folded into label after " — "
--   * checklist_items has NO hold-point column     -> "⛔ HOLD POINT —" kept as label prefix
--   * photo evidence flag = requires_photo         -> set true on every item
--   * trade = null on all existing I-Glaze items   -> kept null (multi-trade not enabled)
--   * item_type = pass_fail (per decision)
--   * all items: is_mandatory=true, fail_note_required=true
--   * template: frequency='job', audit_only=false, requires_approval=true
--
-- Re-run safe: the NOT EXISTS guard prevents a duplicate template of the same
-- name for I-Glaze; if it already exists, BOTH inserts affect 0 rows.
-- =============================================================================

BEGIN;

WITH new_template AS (
  INSERT INTO checklist_templates (company_id, name, frequency, audit_only, requires_approval)
  SELECT
    'e43b6e11-8c49-448b-976b-260f5ddfbbdd',
    'Installation Checklist – Curtain Wall (w/ inserts)',
    'job',
    false,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM checklist_templates
    WHERE company_id = 'e43b6e11-8c49-448b-976b-260f5ddfbbdd'
      AND name = 'Installation Checklist – Curtain Wall (w/ inserts)'
  )
  RETURNING id
)
INSERT INTO checklist_items (
  template_id, company_id, label, item_type, sort_order,
  is_mandatory, requires_photo, requires_video, fail_note_required, trade
)
SELECT
  nt.id,
  'e43b6e11-8c49-448b-976b-260f5ddfbbdd',
  v.label,
  'pass_fail',
  v.ord,
  true,   -- is_mandatory
  true,   -- requires_photo (evidence)
  false,  -- requires_video
  true,   -- fail_note_required
  null    -- trade
FROM new_template nt
CROSS JOIN (VALUES
  (1,  'Gridlines and datums provided and agreed'),
  (2,  '⛔ HOLD POINT — Structural openings correct to RFL drawings'),
  (3,  'Quality and integrity of framework checked'),
  (4,  'CW bracket as designed and isolated from structure — quality and integrity checked'),
  (5,  'Framework installed to gridlines and datum'),
  (6,  'Fixings as detailed and fastened correctly — RFL manager to provide correct torque settings to installation team, where applicable'),
  (7,  '⛔ HOLD POINT — EPDM membrane correctly installed and sealed'),
  (8,  'Glazing gaskets checked and correctly sealed'),
  (9,  'Glazing supports checked'),
  (10, 'Correct glass identified and installed in correct orientation — Kite mark positioned to bottom corner'),
  (11, 'Glass free from defects (scratches)'),
  (12, 'Window/door insert installed and square to opening'),
  (13, 'Installation of perimeter pressings inspected'),
  (14, 'Pressure plate gaskets installed correctly'),
  (15, 'Cover caps installed flush and correctly'),
  (16, 'Glazing insert gaskets inspected'),
  (17, 'Window/door insert — operation checked — Operates smooth and freely'),
  (18, 'Silicone seals inspected'),
  (19, '⛔ HOLD POINT — PPC finish final inspection'),
  (20, 'Final commission of doors'),
  (21, 'Window/door keys issued — Record quantity of window keys and door keys')
) AS v(ord, label);

-- Inspect before you commit. Expect: 1 template, 21 items.
-- SELECT t.name, count(i.*) AS items
-- FROM checklist_templates t
-- LEFT JOIN checklist_items i ON i.template_id = t.id
-- WHERE t.company_id = 'e43b6e11-8c49-448b-976b-260f5ddfbbdd'
--   AND t.name = 'Installation Checklist – Curtain Wall (w/ inserts)'
-- GROUP BY t.name;

COMMIT;
