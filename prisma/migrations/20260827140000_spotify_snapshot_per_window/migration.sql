-- Uma linha por janela de tempo, em vez de uma por usuário. As linhas que já
-- existem têm timeRange preenchido (a janela padrão do sync), então cabem no
-- unique composto sem conversão.

-- DropIndex
DROP INDEX "spotify_taste_snapshots_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "spotify_taste_snapshots_userId_timeRange_key" ON "spotify_taste_snapshots"("userId", "timeRange");

-- Quem já estava vinculado só tem a janela padrão: o dado ficou incompleto por
-- definição quando o modelo mudou. Zerar o lastSyncedAt põe todos na fila do
-- reconciler, que busca as três no próximo tick — sem isso, ficariam até 24h
-- oferecendo um seletor com duas abas vazias.
UPDATE "spotify_links" SET "lastSyncedAt" = NULL;
