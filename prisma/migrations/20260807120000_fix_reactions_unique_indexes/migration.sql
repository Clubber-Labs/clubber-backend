-- Os índices eram parciais (WHERE ... IS NOT NULL), forma que o `@@unique` do Prisma
-- não consegue expressar — o schema divergia do banco a cada `migrate dev`.
-- No Postgres NULLs são distintos em índice único, então o parcial e o total são
-- equivalentes aqui: nenhuma linha muda de comportamento.
DROP INDEX IF EXISTS "reactions_user_event_unique";
CREATE UNIQUE INDEX "reactions_user_event_unique" ON "reactions"("userId", "eventId");

DROP INDEX IF EXISTS "reactions_user_post_unique";
CREATE UNIQUE INDEX "reactions_user_post_unique" ON "reactions"("userId", "postId");
