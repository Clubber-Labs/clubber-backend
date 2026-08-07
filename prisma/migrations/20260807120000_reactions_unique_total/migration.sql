-- Os índices parciais criados em 20260413053745 assumiam que unique não valia
-- para colunas nullable. No Postgres o default é NULLS DISTINCT: o unique total
-- já permite N linhas com eventId/postId nulos, então o WHERE era redundante e
-- só gerava drift contra o @@unique do schema (quebrando o `prisma migrate dev`).
DROP INDEX IF EXISTS "reactions_user_event_unique";
CREATE UNIQUE INDEX "reactions_user_event_unique" ON "reactions"("userId", "eventId");

DROP INDEX IF EXISTS "reactions_user_post_unique";
CREATE UNIQUE INDEX "reactions_user_post_unique" ON "reactions"("userId", "postId");
