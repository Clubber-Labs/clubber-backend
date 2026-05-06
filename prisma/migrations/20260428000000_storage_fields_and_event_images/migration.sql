-- Adiciona campos de avatar ao usuário (URL pública + key opaca do storage)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarKey" TEXT;

-- Remove coluna imageUrl legada da tabela de eventos
ALTER TABLE "events" DROP COLUMN IF EXISTS "imageUrl";

-- Tabela de imagens de evento
CREATE TABLE IF NOT EXISTS "event_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "event_images_eventId_order_idx" ON "event_images"("eventId", "order");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'event_images_eventId_fkey'
    ) THEN
        ALTER TABLE "event_images"
            ADD CONSTRAINT "event_images_eventId_fkey"
            FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
