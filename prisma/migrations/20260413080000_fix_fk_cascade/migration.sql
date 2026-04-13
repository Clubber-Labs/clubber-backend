-- Corrige as foreign keys para usar CASCADE onde necessário,
-- garantindo que ao deletar um pai, os filhos são removidos automaticamente.

-- event_attendances: CASCADE em userId e eventId
ALTER TABLE "event_attendances" DROP CONSTRAINT "event_attendances_userId_fkey";
ALTER TABLE "event_attendances" DROP CONSTRAINT "event_attendances_eventId_fkey";
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- posts: CASCADE em authorId e eventId
ALTER TABLE "posts" DROP CONSTRAINT "posts_authorId_fkey";
ALTER TABLE "posts" DROP CONSTRAINT "posts_eventId_fkey";
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "posts" ADD CONSTRAINT "posts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- comments: CASCADE em authorId, eventId e postId
ALTER TABLE "comments" DROP CONSTRAINT "comments_authorId_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_eventId_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_postId_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- reactions: CASCADE em userId, eventId e postId
ALTER TABLE "reactions" DROP CONSTRAINT "reactions_userId_fkey";
ALTER TABLE "reactions" DROP CONSTRAINT "reactions_eventId_fkey";
ALTER TABLE "reactions" DROP CONSTRAINT "reactions_postId_fkey";
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
