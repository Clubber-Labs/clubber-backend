-- Tagging de SUBCATEGORIAS (chaves de interesse: subcategoria de venue OU gênero
-- musical) em eventos, spots e séries. É text[] config-driven (sem enum, igual a
-- user_subcategory_preferences) com índice GIN para match por interseção
-- (hasSome / &&), espelhando o índice de `categories`. Coluna nova, default []
-- — nada a backfillar: eventos/spots legados nascem sem subcategoria.

ALTER TABLE "events" ADD COLUMN "subcategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "spots" ADD COLUMN "subcategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "event_series" ADD COLUMN "subcategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "events_subcategories_idx" ON "events" USING GIN ("subcategories");
CREATE INDEX "spots_subcategories_idx" ON "spots" USING GIN ("subcategories");
CREATE INDEX "event_series_subcategories_idx" ON "event_series" USING GIN ("subcategories");
