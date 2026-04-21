import { PrismaClient } from '@prisma/client'

export const testPrisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
})
