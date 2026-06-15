-- Raio de interesse (km) para a recomendação de spots, por usuário. Espelha o
-- notifyRadiusKm das notificações: default por usuário, sobrescrevível por
-- request na geração de sugestões; teto operacional em SPOT_MAX_RADIUS_KM.
-- Aditivo e com default: seguro em backfill (linhas existentes recebem 10).
ALTER TABLE "users" ADD COLUMN "spotRadiusKm" INTEGER NOT NULL DEFAULT 10;
