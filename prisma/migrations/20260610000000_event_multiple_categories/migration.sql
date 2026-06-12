-- Evento passa a aceitar MÚLTIPLAS categorias: enum escalar -> array de enum.
-- Backfill preserva o dado existente envolvendo a categoria única num array.

-- 1. Nova coluna array (default temporário só para popular linhas existentes).
ALTER TABLE "events"
  ADD COLUMN "categories" "EventCategory"[] NOT NULL DEFAULT ARRAY[]::"EventCategory"[];

-- 2. Backfill: cada evento herda sua categoria atual como lista de um elemento.
UPDATE "events" SET "categories" = ARRAY["category"]::"EventCategory"[];

-- 3. Remove o default (Prisma trata scalar list como NOT NULL sem default).
ALTER TABLE "events" ALTER COLUMN "categories" DROP DEFAULT;

-- 4. Remove a coluna antiga.
ALTER TABLE "events" DROP COLUMN "category";

-- 5. Índice GIN para filtros/match por interseção (hasSome / = ANY).
CREATE INDEX "events_categories_idx" ON "events" USING GIN ("categories");
