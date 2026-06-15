-- Preferência de subcategoria por usuário (2º nível da taxonomia de rolês).
-- Espelha user_category_preferences; `subcategory` é chave da taxonomia config
-- (validada no input), por isso TEXT e não enum.
CREATE TABLE "user_subcategory_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subcategory" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_subcategory_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_subcategory_preferences_userId_subcategory_key"
  ON "user_subcategory_preferences" ("userId", "subcategory");

CREATE INDEX "user_subcategory_preferences_userId_idx"
  ON "user_subcategory_preferences" ("userId");

ALTER TABLE "user_subcategory_preferences"
  ADD CONSTRAINT "user_subcategory_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
