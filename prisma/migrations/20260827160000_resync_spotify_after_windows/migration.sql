-- Quem vinculou antes das três janelas tem só a padrão gravada: o dado ficou
-- incompleto por definição quando o modelo mudou, e o perfil ofereceria um
-- seletor pela metade.
--
-- Zerar o lastSyncedAt põe todos na fila do reconciler, que busca as três no
-- ritmo dele (lote de 50 por tick, parando no 429). É de propósito que não
-- exista script pra forçar isso: varrer todos de uma vez seria exatamente o
-- que o reconciler existe pra evitar.
UPDATE "spotify_links" SET "lastSyncedAt" = NULL;
