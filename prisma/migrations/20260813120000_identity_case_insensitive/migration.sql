-- Identidade (e-mail e username) passa a ser case-insensitive: login,
-- recuperação de senha, cadastro e checagem de disponibilidade comparam por
-- lower(). Sem unicidade sobre lower(), "Neto" e "neto" coexistiriam e a
-- resolução do identificador do login seria ambígua.
--
-- Índice funcional (e não coluna normalizada) porque a unicidade precisa valer
-- inclusive para dado gravado fora do cadastro — seed, correção manual, import.
-- A normalização do valor para minúsculo vem logo depois, em
-- 20260813130000_normalize_identity_lowercase.
--
-- Os @unique simples de "email"/"username" ficam: são redundantes para a
-- unicidade (o índice funcional é mais forte), mas mantêm o schema.prisma fiel
-- ao banco e o findUnique do Prisma disponível para busca por valor exato.
--
-- Expressão em índice não é representável no schema.prisma (mesma situação das
-- colunas geography): `prisma migrate diff` vai propor DROP INDEX destes dois —
-- nunca aceite (ver CLAUDE.md, seção Banco de dados).

-- Pré-checagem: contas que hoje diferem só pela caixa fariam o CREATE UNIQUE
-- INDEX falhar no meio do deploy com um erro do Postgres sobre a chave
-- duplicada. Falha antes, com instrução — e sem imprimir e-mail/username no log
-- (o levantamento de quem colide está na descrição do PR).
DO $$
DECLARE colisoes bigint;
BEGIN
  SELECT count(*) INTO colisoes FROM (
    SELECT 1 FROM "users" GROUP BY lower("email") HAVING count(*) > 1
    UNION ALL
    SELECT 1 FROM "users" GROUP BY lower("username") HAVING count(*) > 1
  ) c;

  IF colisoes > 0 THEN
    RAISE EXCEPTION 'Existem % identidade(s) que diferem apenas pela caixa (e-mail e/ou username). Resolva (renomear/mesclar as contas) antes de aplicar esta migration.', colisoes;
  END IF;
END $$;

CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));
