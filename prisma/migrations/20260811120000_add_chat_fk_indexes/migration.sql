-- Índices das FKs de coluna única das tabelas de chat. Sem eles o Postgres varre
-- a tabela inteira a cada linha referenciada apagada (cascade/set null) — apagar
-- uma conta ou uma conversa vira seq scan em `messages`.
--
-- IF NOT EXISTS: em bases grandes, crie-os antes com CREATE INDEX CONCURRENTLY
-- (não pode rodar na transação da migration) e esta migration passa como no-op.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_createdById_idx" ON "conversations"("createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_senderId_idx" ON "messages"("senderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_replyToId_idx" ON "messages"("replyToId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_reactions_userId_idx" ON "message_reactions"("userId");
