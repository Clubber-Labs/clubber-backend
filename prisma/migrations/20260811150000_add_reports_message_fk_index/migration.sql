-- FK externa apontando para as tabelas de chat: reports.messageId (SetNull) só
-- era coberta por índices compostos liderados por reporterId. O cascade de
-- messages (apagar conversa/conta) dispara `UPDATE reports SET "messageId" =
-- NULL WHERE "messageId" = <id>` por mensagem apagada — sem este índice, cada
-- fixup é um seq scan em reports.
--
-- IF NOT EXISTS: em bases grandes, crie antes com CREATE INDEX CONCURRENTLY
-- (não pode rodar na transação da migration) e esta migration passa como no-op.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reports_message_idx" ON "reports"("messageId");
