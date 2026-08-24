-- Envelope encryption do chat: a KEK (env, versionada) envelopa uma DEK por
-- conversa, e a DEK cifra o texto das mensagens. Rotacionar a KEK reescreve as
-- linhas desta tabela — nunca o ciphertext das mensagens.
--
-- Migration puramente ADITIVA: toda coluna nasce nullable e ninguém a lê ainda.
-- `messages.content` continua existindo (leitura dual) até o backfill terminar.

-- CreateTable
CREATE TABLE "conversation_keys" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "kekVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "shreddedAt" TIMESTAMP(3),

    CONSTRAINT "conversation_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_keys_conversationId_version_key" ON "conversation_keys"("conversationId", "version");

-- CreateIndex
CREATE INDEX "conversation_keys_conversationId_retiredAt_idx" ON "conversation_keys"("conversationId", "retiredAt");

-- CreateIndex
-- Alvo do reconciler de rotação: varre `kekVersion < ativa` sem seq scan.
CREATE INDEX "conversation_keys_kekVersion_idx" ON "conversation_keys"("kekVersion");

-- AddForeignKey
ALTER TABLE "conversation_keys" ADD CONSTRAINT "conversation_keys_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- contentCipher: `1.<b64 iv>.<b64 tag>.<b64 ct>`. A coluna NULA é o que marca
-- uma linha como legado na leitura dual — não usar data nem flag global.
ALTER TABLE "messages" ADD COLUMN     "contentCipher" TEXT,
ADD COLUMN     "contentKeyVersion" INTEGER;

-- AlterTable
-- Anexo tem DEK PRÓPRIA (dekWrapped), nunca a da conversa: este material é
-- entregue ao app, e vazá-lo não pode custar o histórico de texto.
-- IV/tag em coluna mantêm o ciphertext do mesmo tamanho do plaintext, então a
-- cota de storage segue significando o mesmo que antes.
ALTER TABLE "message_attachments" ADD COLUMN     "chunkSize" INTEGER,
ADD COLUMN     "cipherAlg" TEXT,
ADD COLUMN     "cipherIv" BYTEA,
ADD COLUMN     "cipherTag" BYTEA,
ADD COLUMN     "dekWrapped" BYTEA,
ADD COLUMN     "kekVersion" INTEGER,
ADD COLUMN     "plainSize" INTEGER,
ADD COLUMN     "thumbnailIv" BYTEA,
ADD COLUMN     "thumbnailTag" BYTEA;

-- CreateIndex
CREATE INDEX "message_attachments_kekVersion_idx" ON "message_attachments"("kekVersion");
