-- Nasce DESLIGADO, ao contrário das outras preferências: o seletor é opt-in
-- porque expõe três janelas do gosto onde antes havia uma.
ALTER TABLE "users" ADD COLUMN "spotifyWindowVisible" BOOLEAN NOT NULL DEFAULT false;
