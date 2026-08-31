-- Resposta a comentário: thread rasa de 1 nível (o service recusa pai que já
-- seja resposta). Cascade porque apagar o comentário raiz tem que levar as
-- respostas junto — sem isso sobrariam órfãs apontando para linha inexistente.
ALTER TABLE "comments" ADD COLUMN "parentId" TEXT;

ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "comments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "comments_parentId_createdAt_idx" ON "comments"("parentId", "createdAt");

ALTER TYPE "NotificationType" ADD VALUE 'COMMENT_REPLY';
