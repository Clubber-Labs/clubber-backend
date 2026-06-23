-- Índice GiST PARCIAL sobre eventos públicos.
--
-- Todas as queries de descoberta (mapa/bbox, raio, KNN, proximidade) filtram
-- `isPublic = true` antes do predicado espacial (ver lib/spatial.ts e o
-- visibilityPredicate). O índice GiST cheio (events_location_idx) indexa TODOS
-- os eventos; este parcial indexa só os públicos, casando exatamente o filtro
-- dessas queries — índice menor, varredura mais barata e menos CPU no primário.
CREATE INDEX IF NOT EXISTS "events_public_location_idx"
  ON "events" USING gist ("location")
  WHERE "isPublic" = true;
