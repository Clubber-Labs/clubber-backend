-- Migration: add_lgpd_consent
-- LGPD — Consentimento Granular (Política de Privacidade v1.0)

CREATE TABLE "user_consents" (
    "id"                 TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"             TEXT        NOT NULL,

    "essentialAccepted"  BOOLEAN     NOT NULL DEFAULT true,

    -- 7 consentimentos granulares do PDF de Política de Privacidade
    "locationPrecise"    BOOLEAN     NOT NULL DEFAULT false,
    "socialFeed"         BOOLEAN     NOT NULL DEFAULT false,
    "socialVisibility"   BOOLEAN     NOT NULL DEFAULT false,
    "pushNotifications"  BOOLEAN     NOT NULL DEFAULT false,
    "marketing"          BOOLEAN     NOT NULL DEFAULT false,
    "analytics"          BOOLEAN     NOT NULL DEFAULT false,
    "surveys"            BOOLEAN     NOT NULL DEFAULT false,

    "consentVersion"     TEXT        NOT NULL DEFAULT '1.0',
    "ipAddress"          TEXT,
    "userAgent"          TEXT,
    "collectedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "revokedAt"          TIMESTAMPTZ,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_consents_userId_key" ON "user_consents"("userId");
CREATE INDEX "user_consents_userId_idx" ON "user_consents"("userId");

ALTER TABLE "user_consents"
    ADD CONSTRAINT "user_consents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- Audit log: imutável, append-only
CREATE TABLE "consent_audit_logs" (
    "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"         TEXT        NOT NULL,
    "action"         TEXT        NOT NULL,
    "changedFields"  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "ipAddress"      TEXT,
    "userAgent"      TEXT,
    "consentVersion" TEXT        NOT NULL DEFAULT '1.0',
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "consent_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_audit_logs_userId_idx"    ON "consent_audit_logs"("userId");
CREATE INDEX "consent_audit_logs_createdAt_idx" ON "consent_audit_logs"("createdAt");

ALTER TABLE "consent_audit_logs"
    ADD CONSTRAINT "consent_audit_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- Trigger para atualizar updatedAt automaticamente
CREATE OR REPLACE FUNCTION update_user_consents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_consents_updated_at
    BEFORE UPDATE ON "user_consents"
    FOR EACH ROW
    EXECUTE FUNCTION update_user_consents_updated_at();
