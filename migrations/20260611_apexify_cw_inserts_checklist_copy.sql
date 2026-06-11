-- =============================================================================
-- Duplicate I-Glaze QA template -> Apexify Agency (test company)
-- Source template: f0fabaa5-b8df-4154-b279-b5316743ea6d  (I-Glaze, READ ONLY)
-- Target company:  Apexify Agency  00695d96-0465-4f38-8d0a-2e494063b908
-- Date:            2026-06-11
--
-- Copies the template row (same name + flags, requires_approval=true) and all
-- 21 items with identical settings (label, item_type, sort_order, is_mandatory,
-- requires_photo, requires_video, fail_note_required, trade) under Apexify's id.
--
-- Reads from the I-Glaze template; does NOT modify it or any I-Glaze data.
-- Re-run safe: NOT EXISTS guard blocks a duplicate Apexify template of same name;
-- if it already exists, BOTH inserts affect 0 rows.
-- =============================================================================

BEGIN;

WITH new_template AS (
  INSERT INTO checklist_templates (company_id, name, frequency, audit_only, requires_approval)
  SELECT
    '00695d96-0465-4f38-8d0a-2e494063b908',
    src.name,
    src.frequency,
    src.audit_only,
    src.requires_approval
  FROM checklist_templates src
  WHERE src.id = 'f0fabaa5-b8df-4154-b279-b5316743ea6d'
    AND NOT EXISTS (
      SELECT 1 FROM checklist_templates
      WHERE company_id = '00695d96-0465-4f38-8d0a-2e494063b908'
        AND name = src.name
    )
  RETURNING id
)
INSERT INTO checklist_items (
  template_id, company_id, label, item_type, sort_order,
  is_mandatory, requires_photo, requires_video, fail_note_required, trade
)
SELECT
  nt.id,
  '00695d96-0465-4f38-8d0a-2e494063b908',
  src.label,
  src.item_type,
  src.sort_order,
  src.is_mandatory,
  src.requires_photo,
  src.requires_video,
  src.fail_note_required,
  src.trade
FROM new_template nt
CROSS JOIN checklist_items src
WHERE src.template_id = 'f0fabaa5-b8df-4154-b279-b5316743ea6d'
ORDER BY src.sort_order;

-- Expect: 1 template, 21 items under Apexify.
-- SELECT t.name, count(i.*) AS items
-- FROM checklist_templates t
-- LEFT JOIN checklist_items i ON i.template_id = t.id
-- WHERE t.company_id = '00695d96-0465-4f38-8d0a-2e494063b908'
--   AND t.name = 'Installation Checklist – Curtain Wall (w/ inserts)'
-- GROUP BY t.name;

COMMIT;
