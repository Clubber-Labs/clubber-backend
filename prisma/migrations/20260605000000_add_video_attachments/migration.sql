-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'VIDEO';

-- AlterTable
ALTER TABLE "message_attachments" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;
