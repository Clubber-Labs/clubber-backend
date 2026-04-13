/*
  Warnings:

  - You are about to drop the column `followersCount` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `followingCount` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "followersCount",
DROP COLUMN "followingCount";
