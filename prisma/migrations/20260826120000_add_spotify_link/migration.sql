-- CreateEnum
CREATE TYPE "SpotifyLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "spotify_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spotifyUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT '{}',
    "status" "SpotifyLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "hiddenArtistIds" TEXT[] NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spotify_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spotify_taste_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeRange" TEXT NOT NULL,
    "artists" JSONB NOT NULL,
    "genreKeys" TEXT[] NOT NULL DEFAULT '{}',
    "unmappedGenres" TEXT[] NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spotify_taste_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spotify_links_userId_key" ON "spotify_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "spotify_links_spotifyUserId_key" ON "spotify_links"("spotifyUserId");

-- CreateIndex
CREATE INDEX "spotify_links_status_lastSyncedAt_idx" ON "spotify_links"("status", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "spotify_taste_snapshots_userId_key" ON "spotify_taste_snapshots"("userId");

-- AddForeignKey
ALTER TABLE "spotify_links" ADD CONSTRAINT "spotify_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spotify_taste_snapshots" ADD CONSTRAINT "spotify_taste_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "spotifyArtistsVisible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user_consents" ADD COLUMN "spotifyData" BOOLEAN NOT NULL DEFAULT false;
