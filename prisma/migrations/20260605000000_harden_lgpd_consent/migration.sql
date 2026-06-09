-- Harden LGPD consent audit actions and remove redundant updatedAt trigger.

DO $$
BEGIN
  CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'UPDATED', 'REVOKED', 'EXPORTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "consent_audit_logs"
  ALTER COLUMN "action" TYPE "ConsentAction"
  USING "action"::"ConsentAction";

DROP TRIGGER IF EXISTS trg_user_consents_updated_at ON "user_consents";
DROP FUNCTION IF EXISTS update_user_consents_updated_at();
