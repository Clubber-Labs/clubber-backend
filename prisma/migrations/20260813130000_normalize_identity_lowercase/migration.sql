-- Minúsculo passa a ser a forma canônica da identidade: o cadastro normaliza na
-- escrita (usernameFieldSchema/email em users.schema.ts) e as contas que já
-- existem são convertidas aqui, para não ficar metade do banco com a caixa
-- antiga no perfil.
--
-- Seguro depois de 20260813120000_identity_case_insensitive: com o índice único
-- sobre lower() já em vigor, não existem dois registros cujo lower() coincida —
-- então baixar a caixa não pode gerar duplicata.
--
-- O WHERE não é decoração: só as linhas fora da forma canônica são escritas, e
-- torna o UPDATE idempotente. Em base grande, rode-o em lotes antes do deploy
-- (`... WHERE ... LIMIT`) — quando a migration rodar, já não sobra linha para
-- atualizar. O username é público (aparece em feed, chat, comentários): a
-- mudança de caixa é visível para quem se cadastrou com maiúscula.

UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
UPDATE "users" SET "username" = lower("username") WHERE "username" <> lower("username");
