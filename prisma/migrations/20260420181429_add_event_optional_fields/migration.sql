-- Restaura campos opcionais que existiam na migration consolidada removida.
-- IF NOT EXISTS pra ser idempotente em bancos que já tenham aplicado a antiga consolidada.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "maxCapacity" INTEGER;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
