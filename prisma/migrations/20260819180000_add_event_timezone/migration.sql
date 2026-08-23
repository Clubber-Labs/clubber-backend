-- Evento passa a guardar o fuso do LOCAL: `date` segue sendo o instante UTC,
-- mas a hora marcada é hora de parede de lá (o UTC de "22h" muda no DST).
-- Linhas existentes nasceram todas no Brasil; o DEFAULT preenche o histórico e
-- sai em seguida, para que criação nova seja obrigada a derivar de lat/lng.
ALTER TABLE "events"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE "events" ALTER COLUMN "timezone" DROP DEFAULT;

-- Séries antigas ficam NULL de propósito: sem fuso, buildOccurrenceDates
-- mantém o comportamento em UTC que já tinham (nada muda retroativamente).
ALTER TABLE "event_series" ADD COLUMN "timezone" TEXT;
