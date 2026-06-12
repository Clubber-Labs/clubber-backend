-- Lifecycle do spot: lembrete de renovação + tipo de notificação.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SPOT_RENEWAL';

-- AlterTable: marcador do lembrete de renovação (NULL = ainda não lembrado).
ALTER TABLE "spots" ADD COLUMN "renewalNotifiedAt" TIMESTAMP(3);

-- CreateIndex: spots vencendo ainda não lembrados.
CREATE INDEX "spots_renewal_reminder_idx" ON "spots" ("renewalNotifiedAt", "endsAt", "canceledAt");
