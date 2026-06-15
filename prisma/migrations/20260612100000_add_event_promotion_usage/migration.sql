-- CreateTable: quota mensal de promoções de evento (premium).
-- period = 1º dia do mês (UTC); consumo atômico via upsert/increment dentro
-- da transação de criação do destaque.
CREATE TABLE "event_promotion_usage" (
    "userId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_promotion_usage_pkey" PRIMARY KEY ("userId","period")
);

-- AddForeignKey
ALTER TABLE "event_promotion_usage" ADD CONSTRAINT "event_promotion_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
