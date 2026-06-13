-- Cap diário de notificações de descoberta (alcance premium do SPOT_NEARBY).
-- CreateTable
CREATE TABLE "spot_discovery_usage" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spot_discovery_usage_pkey" PRIMARY KEY ("userId", "day")
);

-- AddForeignKey
ALTER TABLE "spot_discovery_usage" ADD CONSTRAINT "spot_discovery_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
