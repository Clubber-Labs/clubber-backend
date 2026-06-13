-- Quota diária de geração de sugestões de spot: uma linha por (usuário, dia).
-- CreateTable
CREATE TABLE "spot_generation_usage" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spot_generation_usage_pkey" PRIMARY KEY ("userId", "day")
);

-- AddForeignKey
ALTER TABLE "spot_generation_usage" ADD CONSTRAINT "spot_generation_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
