/*
  Warnings:

  - Added the required column `updatedAt` to the `comments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "follows" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "reactions" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- RenameIndex
ALTER INDEX "reactions_userId_eventId_key" RENAME TO "reactions_user_event_unique";

-- RenameIndex
ALTER INDEX "reactions_userId_postId_key" RENAME TO "reactions_user_post_unique";

-- Índices parciais para garantir unique mesmo com campos nullable
-- Um usuário só pode reagir uma vez por evento (quando eventId não é nulo)
DROP INDEX IF EXISTS "reactions_user_event_unique";
CREATE UNIQUE INDEX "reactions_user_event_unique" ON "reactions"("userId", "eventId") WHERE "eventId" IS NOT NULL;

-- Um usuário só pode reagir uma vez por post (quando postId não é nulo)
DROP INDEX IF EXISTS "reactions_user_post_unique";
CREATE UNIQUE INDEX "reactions_user_post_unique" ON "reactions"("userId", "postId") WHERE "postId" IS NOT NULL;
