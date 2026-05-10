-- Migration 0030: Convert conversations.playbook_override from VARCHAR(50) to JSONB
--
-- The varchar encoding ('staff:<uuid>' or plain intentKey string) was fragile:
--   • varchar(50) was too short for 'staff:{36-char-uuid}:model:staff_confirm' (61 chars)
--   • Parsing required string prefix checks scattered across the codebase
--
-- New JSONB shape (two variants):
--   { "type": "staff",    "staffId": "<uuid>", "confirmationModel": "staff_confirm|instant" }
--   { "type": "playbook", "intentKey": "<string>" }
--
-- The USING clause migrates all existing live rows safely:
--   • NULL stays NULL
--   • 'staff:<uuid>' → { "type": "staff", "staffId": "<uuid>" }
--   • anything else  → { "type": "playbook", "intentKey": "<value>" }

ALTER TABLE conversations
  ALTER COLUMN playbook_override TYPE jsonb
  USING CASE
    WHEN playbook_override IS NULL
      THEN NULL
    WHEN playbook_override LIKE 'staff:%'
      THEN jsonb_build_object(
             'type',    'staff',
             'staffId', substring(playbook_override FROM 7)
           )
    ELSE
      jsonb_build_object(
        'type',      'playbook',
        'intentKey', playbook_override
      )
  END;

COMMENT ON COLUMN conversations.playbook_override IS
  'JSONB: { type: "staff", staffId, confirmationModel? } | { type: "playbook", intentKey }. Set by START_SCHEDULING or ACTIVATE_PLAYBOOK flow nodes.';
