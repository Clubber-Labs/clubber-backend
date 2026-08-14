-- Preferências de produto saem de user_consents e viram campos do User.
-- Base legal é contrato / legítimo interesse com opt-out, então nascem `true` —
-- ao contrário do consentimento, que exige opt-in explícito.
ALTER TABLE "users"
    ADD COLUMN "socialFeed"       BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "socialVisibility" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "analytics"        BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "user_consents"
    DROP COLUMN "socialFeed",
    DROP COLUMN "socialVisibility",
    DROP COLUMN "analytics";

-- Aceite de documento por versão, append-only.
CREATE TYPE "TermsDocument" AS ENUM ('TERMS_OF_USE', 'PRIVACY_POLICY');

CREATE TABLE "terms_acceptances" (
    "id"         TEXT           NOT NULL,
    "userId"     TEXT           NOT NULL,
    "document"   "TermsDocument" NOT NULL,
    "version"    TEXT           NOT NULL,
    "acceptedAt" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"  TEXT,
    "userAgent"  TEXT,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "terms_acceptances_userId_document_version_key"
    ON "terms_acceptances"("userId", "document", "version");

CREATE INDEX "terms_acceptances_userId_document_acceptedAt_idx"
    ON "terms_acceptances"("userId", "document", "acceptedAt");

ALTER TABLE "terms_acceptances"
    ADD CONSTRAINT "terms_acceptances_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
