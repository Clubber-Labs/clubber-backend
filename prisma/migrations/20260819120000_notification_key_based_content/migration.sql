-- Notificação passa a guardar params (snapshot) em vez de título/corpo prontos:
-- o texto é renderizado na leitura, no idioma de quem lê.
ALTER TABLE "notifications" ADD COLUMN "params" JSONB;

-- Backfill do que dá para recuperar do texto materializado: nos tipos de
-- proximidade o "body" ERA exatamente o título da entidade.
UPDATE "notifications"
SET "params" = jsonb_build_object('eventTitle', "body")
WHERE "type" = 'EVENT_NEARBY';

UPDATE "notifications"
SET "params" = jsonb_build_object('spotTitle', "body")
WHERE "type" = 'SPOT_NEARBY';

-- Digest de destaque: mesmo tipo, copy diferente. A dedupeKey é o único sinal
-- que sobrevive da variante (ver promotedDedupeKey).
UPDATE "notifications"
SET "params" = "params" || '{"promoted": true}'::jsonb
WHERE "dedupeKey" LIKE 'EVENT_NEARBY:promoted:%';

-- SPOT_JOIN/SPOT_RENEWAL têm o título embutido numa frase; recupera do spot.
UPDATE "notifications" n
SET "params" = jsonb_build_object('spotTitle', s."title")
FROM "spots" s
WHERE s."id" = n."spotId"
  AND n."type" IN ('SPOT_JOIN', 'SPOT_RENEWAL');

-- Sobram as de spot já apagado pelo lifecycle: sem título recuperável e com o
-- deep-link morto (spotId órfão). Some em vez de virar linha meio-renderizada.
DELETE FROM "notifications"
WHERE "type" IN ('SPOT_JOIN', 'SPOT_RENEWAL') AND "params" IS NULL;

ALTER TABLE "notifications" DROP COLUMN "title";
ALTER TABLE "notifications" DROP COLUMN "body";
