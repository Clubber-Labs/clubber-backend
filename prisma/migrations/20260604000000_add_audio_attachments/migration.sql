-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'AUDIO');

-- AlterTable
ALTER TABLE "message_attachments" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "kind" "AttachmentKind" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "waveform" INTEGER[];
