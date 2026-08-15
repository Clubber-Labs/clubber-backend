-- Poster do vídeo deixa de ser derivado da key do vídeo (transformação do
-- Cloudinary) e vira objeto próprio no bucket privado do R2 — a key precisa
-- ser persistida para a URL ser assinada a cada leitura.
ALTER TABLE "message_attachments"
    ADD COLUMN "thumbnailKey" TEXT;
