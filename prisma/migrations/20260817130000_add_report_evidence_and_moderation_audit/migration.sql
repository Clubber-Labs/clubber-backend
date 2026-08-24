-- Canal de denúncia sobre chat cifrado: snapshot imutável da prova + trilha de
-- quem da moderação leu conteúdo privado em claro.
--
-- report_evidences NÃO tem FK para messages nem conversations de propósito: a
-- prova precisa sobreviver ao cascade da conversa e ao SetNull de
-- reports.messageId. As referências ficam desnormalizadas.

-- CreateEnum
CREATE TYPE "ReportEvidenceKind" AS ENUM ('CHAT_MESSAGE');

-- CreateEnum
CREATE TYPE "ModerationAccessAction" AS ENUM ('VIEW_EVIDENCE');

-- CreateTable
CREATE TABLE "report_evidences" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "ReportEvidenceKind" NOT NULL DEFAULT 'CHAT_MESSAGE',
    -- DEK própria da evidência: rotação ou crypto-shredding da conversa não
    -- podem destruir a prova que sustenta a punição.
    "wrappedDek" BYTEA NOT NULL,
    "kekVersion" INTEGER NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "alg" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "payloadCipher" BYTEA NOT NULL,
    "conversationId" TEXT,
    "reportedMessageId" TEXT,
    "reportedUserId" TEXT,
    "contextCount" INTEGER NOT NULL DEFAULT 0,
    "retainedMediaKeys" TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "report_evidences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_evidences_reportId_key" ON "report_evidences"("reportId");

-- CreateIndex
CREATE INDEX "report_evidences_kekVersion_idx" ON "report_evidences"("kekVersion");

-- CreateIndex
-- Predicado do reconciler de retenção (purga da prova vencida).
CREATE INDEX "report_evidences_capturedAt_idx" ON "report_evidences"("capturedAt");

-- AddForeignKey
ALTER TABLE "report_evidences" ADD CONSTRAINT "report_evidences_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "moderation_access_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "ModerationAccessAction" NOT NULL,
    "reportId" TEXT,
    "evidenceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_access_logs_adminId_createdAt_idx" ON "moderation_access_logs"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_access_logs_reportId_idx" ON "moderation_access_logs"("reportId");

-- CreateIndex
CREATE INDEX "moderation_access_logs_createdAt_idx" ON "moderation_access_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "moderation_access_logs" ADD CONSTRAINT "moderation_access_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
