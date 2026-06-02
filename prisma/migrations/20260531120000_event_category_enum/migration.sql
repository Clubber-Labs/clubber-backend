-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('MUSIC', 'SPORTS', 'TECH', 'GASTRONOMY', 'ART', 'EDUCATION', 'NIGHTLIFE', 'BUSINESS', 'HEALTH_WELLNESS', 'OUTDOORS', 'GAMING', 'FILM_THEATER', 'FASHION', 'RELIGION', 'FAMILY', 'PETS', 'VOLUNTEERING', 'PARTY', 'OTHER');

-- Normaliza categorias legadas (string livre, em português) para o enum canônico.
-- Roda ANTES do ALTER para que o cast `::"EventCategory"` não falhe.
UPDATE "events" SET "category" = 'PARTY'       WHERE lower("category") IN ('festa', 'party');
UPDATE "events" SET "category" = 'MUSIC'       WHERE lower("category") IN ('show', 'música', 'musica', 'music');
UPDATE "events" SET "category" = 'SPORTS'      WHERE lower("category") IN ('esporte', 'esportes', 'sports');
UPDATE "events" SET "category" = 'GASTRONOMY'  WHERE lower("category") IN ('gastronomia', 'gastronomy', 'comida', 'food');
UPDATE "events" SET "category" = 'TECH'        WHERE lower("category") IN ('tecnologia', 'tech', 'technology');
UPDATE "events" SET "category" = 'ART'         WHERE lower("category") IN ('arte', 'art', 'cultura', 'culture');
UPDATE "events" SET "category" = 'NIGHTLIFE'   WHERE lower("category") IN ('balada', 'nightlife');

-- Tudo que não casou com nenhum valor do enum vira OTHER (evita perda de linha no cast).
UPDATE "events" SET "category" = 'OTHER'
  WHERE "category" NOT IN ('MUSIC', 'SPORTS', 'TECH', 'GASTRONOMY', 'ART', 'EDUCATION', 'NIGHTLIFE', 'BUSINESS', 'HEALTH_WELLNESS', 'OUTDOORS', 'GAMING', 'FILM_THEATER', 'FASHION', 'RELIGION', 'FAMILY', 'PETS', 'VOLUNTEERING', 'PARTY', 'OTHER');

-- Converte a coluna String -> enum preservando os dados normalizados.
ALTER TABLE "events"
  ALTER COLUMN "category" TYPE "EventCategory" USING ("category"::"EventCategory");
