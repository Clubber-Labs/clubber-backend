-- Link compartilhável de convite: token opaco, expiração no fim do evento,
-- revogável; o aceite materializa um EventInvite (usesCount conta só aceites novos).
CREATE TABLE "event_invite_links" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_invite_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_invite_links_token_key" ON "event_invite_links"("token");

CREATE INDEX "event_invite_links_eventId_revokedAt_idx" ON "event_invite_links"("eventId", "revokedAt");

ALTER TABLE "event_invite_links" ADD CONSTRAINT "event_invite_links_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_invite_links" ADD CONSTRAINT "event_invite_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
