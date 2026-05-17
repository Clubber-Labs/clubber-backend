-- Garantia DB-level de que não existam janelas de destaque ativas sobrepostas
-- pro mesmo evento. Cobre a race window entre o overlap check otimista do
-- service e o INSERT da janela. O service ainda faz o check pra dar 409
-- previsível na maioria dos casos; essa constraint é safety-net.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "featured_events"
ADD CONSTRAINT "featured_events_no_overlap_active"
EXCLUDE USING gist (
  "eventId" WITH =,
  tsrange("startsAt", "endsAt", '[)') WITH &&
) WHERE ("canceledAt" IS NULL);
