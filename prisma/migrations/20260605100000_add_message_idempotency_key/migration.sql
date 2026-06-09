-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_senderId_idempotencyKey_key" ON "messages"("conversationId", "senderId", "idempotencyKey");
