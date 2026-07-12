-- Estabelecimento (Google Places) opcional no evento e no template da série.
ALTER TABLE "events" ADD COLUMN "placeId" TEXT, ADD COLUMN "venueName" TEXT;
ALTER TABLE "event_series" ADD COLUMN "placeId" TEXT, ADD COLUMN "venueName" TEXT;
