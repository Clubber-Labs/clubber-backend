-- CreateEnum
CREATE TYPE "FollowStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('INTERESTED', 'CONFIRMED', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'ANGRY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastname" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "bio" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "birthdate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "status" "FollowStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "category" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "maxCapacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_attendances" (
    "id" TEXT NOT NULL,
    "type" "AttendanceType" NOT NULL DEFAULT 'CONFIRMED',
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "eventId" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_invites" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "invitedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "type" "ReactionType" NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "follows_followingId_status_id_idx" ON "follows"("followingId", "status", "id");

-- CreateIndex
CREATE INDEX "follows_followerId_status_id_idx" ON "follows"("followerId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "follows_followerId_followingId_key" ON "follows"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "event_attendances_eventId_createdAt_idx" ON "event_attendances"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_attendances_userId_eventId_key" ON "event_attendances"("userId", "eventId");

-- CreateIndex
CREATE INDEX "posts_eventId_createdAt_idx" ON "posts"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_eventId_createdAt_idx" ON "comments"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_postId_createdAt_idx" ON "comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "event_invites_invitedId_idx" ON "event_invites"("invitedId");

-- CreateIndex
CREATE UNIQUE INDEX "event_invites_eventId_invitedId_key" ON "event_invites"("eventId", "invitedId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_user_event_unique" ON "reactions"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_user_post_unique" ON "reactions"("userId", "postId");

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_invitedId_fkey" FOREIGN KEY ("invitedId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
