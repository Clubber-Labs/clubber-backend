-- Denormaliza users.isPrivate do autor em events.authorIsPrivate, mantido em
-- sync por triggers. Permite filtrar a visibilidade por coluna do próprio
-- events na busca espacial, preservando o index-scan KNN do GiST (sem JOIN
-- com users, que forçava seq-scan + sort de ~80k linhas).

ALTER TABLE "events" ADD COLUMN "authorIsPrivate" BOOLEAN NOT NULL DEFAULT false;

-- Backfill a partir do autor atual.
UPDATE "events" e
SET "authorIsPrivate" = u."isPrivate"
FROM "users" u
WHERE u.id = e."authorId";

-- Define authorIsPrivate no insert do evento (e se o autor mudar).
CREATE OR REPLACE FUNCTION set_event_author_is_private() RETURNS trigger AS $$
BEGIN
  SELECT "isPrivate" INTO NEW."authorIsPrivate"
  FROM "users" WHERE id = NEW."authorId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_event_author_is_private
BEFORE INSERT OR UPDATE OF "authorId" ON "events"
FOR EACH ROW EXECUTE FUNCTION set_event_author_is_private();

-- Propaga a troca de privacidade do usuário para os eventos dele.
CREATE OR REPLACE FUNCTION propagate_user_is_private() RETURNS trigger AS $$
BEGIN
  IF NEW."isPrivate" IS DISTINCT FROM OLD."isPrivate" THEN
    UPDATE "events" SET "authorIsPrivate" = NEW."isPrivate"
    WHERE "authorId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_is_private_propagate
AFTER UPDATE OF "isPrivate" ON "users"
FOR EACH ROW EXECUTE FUNCTION propagate_user_is_private();
