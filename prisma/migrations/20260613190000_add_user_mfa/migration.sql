-- AlterTable: MFA (TOTP) por conta
ALTER TABLE "users"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecret" TEXT,
  ADD COLUMN "mfaRecoveryCodes" TEXT[] NOT NULL DEFAULT '{}';
