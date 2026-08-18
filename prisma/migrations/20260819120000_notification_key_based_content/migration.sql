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

-- SPOT_JOIN/SPOT_RENEWAL têm o título embutido numa frase de formato fixo.
-- Extrair do próprio body recupera o título QUE O USUÁRIO VIU e não depende do
-- spot ainda existir — o lifecycle apaga spots, e a notificação sobrevive a eles.
UPDATE "notifications"
SET "params" = jsonb_build_object(
  'spotTitle', substring("body" from ' entrou em "(.*)"$')
)
WHERE "type" = 'SPOT_JOIN' AND "body" ~ ' entrou em ".*"$';

UPDATE "notifications"
SET "params" = jsonb_build_object(
  'spotTitle', substring("body" from '^"(.*)" expira em breve')
)
WHERE "type" = 'SPOT_RENEWAL' AND "body" ~ '^".*" expira em breve';

-- Rede para body em formato inesperado: o título atual do spot, se sobreviveu.
UPDATE "notifications" n
SET "params" = jsonb_build_object('spotTitle', s."title")
FROM "spots" s
WHERE s."id" = n."spotId"
  AND n."params" IS NULL
  AND n."type" IN ('SPOT_JOIN', 'SPOT_RENEWAL');

-- Resíduo sem título por nenhum dos caminhos: renderizaria "{{spotTitle}}" cru.
DELETE FROM "notifications"
WHERE "type" IN ('SPOT_JOIN', 'SPOT_RENEWAL') AND "params" IS NULL;

ALTER TABLE "notifications" DROP COLUMN "title";
ALTER TABLE "notifications" DROP COLUMN "body";
