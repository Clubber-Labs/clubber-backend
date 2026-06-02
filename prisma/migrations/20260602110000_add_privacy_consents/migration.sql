-- CreateEnum
CREATE TYPE "PrivacyConsentSource" AS ENUM ('REGISTRATION', 'SETTINGS', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PrivacyConsentAction" AS ENUM ('GRANTED', 'REVOKED', 'UPDATED');

-- CreateEnum
CREATE TYPE "PrivacyRequestType" AS ENUM ('EXPORT', 'DELETE_ANONYMIZE');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "user_privacy_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purposeKey" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" TEXT NOT NULL,
    "termsVersion" TEXT,
    "source" "PrivacyConsentSource" NOT NULL DEFAULT 'SETTINGS',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_privacy_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_consent_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "purposeKey" TEXT NOT NULL,
    "action" "PrivacyConsentAction" NOT NULL,
    "granted" BOOLEAN,
    "policyVersion" TEXT NOT NULL,
    "termsVersion" TEXT,
    "source" "PrivacyConsentSource" NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_consent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_privacy_consents_userId_purposeKey_key" ON "user_privacy_consents"("userId", "purposeKey");

-- CreateIndex
CREATE INDEX "user_privacy_consents_userId_granted_idx" ON "user_privacy_consents"("userId", "granted");

-- CreateIndex
CREATE INDEX "privacy_consent_audit_logs_userId_createdAt_idx" ON "privacy_consent_audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "privacy_consent_audit_logs_purposeKey_createdAt_idx" ON "privacy_consent_audit_logs"("purposeKey", "createdAt");

-- CreateIndex
CREATE INDEX "privacy_requests_userId_requestedAt_idx" ON "privacy_requests"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "privacy_requests_status_requestedAt_idx" ON "privacy_requests"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "user_privacy_consents" ADD CONSTRAINT "user_privacy_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_consent_audit_logs" ADD CONSTRAINT "privacy_consent_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
