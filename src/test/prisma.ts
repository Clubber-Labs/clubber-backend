import { PrismaClient } from '@prisma/client'

const dbUrl = process.env.DATABASE_URL ?? ''

if (!dbUrl.includes('test')) {
  throw new Error(
    `PERIGO: DATABASE_URL não aponta para o banco de teste.\nValor atual: "${dbUrl}"\nConfira se o arquivo .env.test existe e o vitest.config.ts está configurado com globalSetup.`,
  )
}

export const testPrisma = new PrismaClient({
  datasourceUrl: dbUrl,
})
