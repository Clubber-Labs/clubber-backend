-- CreateTable
CREATE TABLE "user_photos" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caption" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_photo_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "photoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_photo_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_photos_userId_createdAt_id_idx" ON "user_photos"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "user_photos_eventId_idx" ON "user_photos"("eventId");

-- CreateIndex
CREATE INDEX "user_photo_images_photoId_order_idx" ON "user_photo_images"("photoId", "order");

-- AddForeignKey
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_photo_images" ADD CONSTRAINT "user_photo_images_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "user_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
