import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'

const envPath = resolve(process.cwd(), '.env.test')

if (!existsSync(envPath)) {
  console.error('.env.test não encontrado — veja o CLAUDE.md (seção Testes).')
  process.exit(1)
}

// Precede o `dotenv/config` do prisma.config.ts, que lê o `.env` (banco de dev):
// dotenv não sobrescreve o que já está no process.env, então o alvo fica sendo
// o conectai_test mesmo com o `.env` presente.
config({ path: envPath })

if (!process.env.DATABASE_URL?.includes('conectai_test')) {
  console.error('DATABASE_URL do .env.test não aponta para o banco de teste.')
  process.exit(1)
}

execFileSync('prisma', ['migrate', 'deploy'], { stdio: 'inherit' })
