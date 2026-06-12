-- Tipos de notificação de spot.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SPOT_NEARBY';
ALTER TYPE "NotificationType" ADD VALUE 'SPOT_JOIN';

-- Referência de alvo do spot (coluna solta, sem FK — igual eventId/postId).
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "spotId" TEXT;
