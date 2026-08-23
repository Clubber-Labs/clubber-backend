-- Adiciona APPLE ao enum. FACEBOOK permanece como legado (sem rota desde
-- 2026-08): removê-lo exigiria migrar as contas antigas de dev.
ALTER TYPE "SocialProvider" ADD VALUE 'APPLE';
