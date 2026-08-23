-- i18n Fase 2: locale e fuso do usuário.
-- localePreference = escolha explícita (null segue o aparelho);
-- deviceLocale = última tag do Accept-Language (fallback de push/e-mail);
-- timezone = IANA do aparelho.
ALTER TABLE "users"
  ADD COLUMN "localePreference" TEXT,
  ADD COLUMN "deviceLocale" TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
