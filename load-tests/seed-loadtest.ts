// Booster de dados para os testes de carga.
//
// O `pnpm db:seed` cria ~50 eventos — pouco para a query geográfica de viewport
// ser representativa sob carga. Este script insere em massa N eventos PÚBLICOS
// adicionais na mesma região (Curitiba) usados pelos cenários k6, distribuídos
// entre os usuários já existentes no banco.
//
// Uso (a partir da raiz do backend, após `pnpm db:seed`):
//   tsx load-tests/seed-loadtest.ts            # default: 5000 eventos
//   EVENTS=20000 tsx load-tests/seed-loadtest.ts
//
// Idempotência: cria eventos marcados com title prefixado por "[loadtest]",
// removendo os anteriores antes de inserir (não toca no seed normal).
import { faker } from '@faker-js/faker/locale/pt_BR'
import { type EventCategory, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TOTAL = Number(process.env.EVENTS || 5000)
const BATCH = 1000
const TITLE_PREFIX = '[loadtest]'

const CATEGORIES: EventCategory[] = [
  'PARTY',
  'MUSIC',
  'SPORTS',
  'ART',
  'GASTRONOMY',
  'TECH',
  'NIGHTLIFE',
  'EDUCATION',
]

async function main() {
  // Guard de ambiente: o script faz deleteMany. Rodado com uma DATABASE_URL de
  // staging/prod (ex.: .env errado no terminal), limparia eventos [loadtest] do
  // ambiente-alvo antes de inserir. Só roda contra banco local/dev/test.
  const dbUrl = process.env.DATABASE_URL ?? ''
  if (!/(localhost|127\.0\.0\.1|conectai_dev|conectai_test)/.test(dbUrl)) {
    throw new Error(
      `DATABASE_URL não aponta para um banco local/dev/test — abortando para evitar deleção acidental.\nValor: "${dbUrl}"`,
    )
  }

  const users = await prisma.user.findMany({ select: { id: true } })
  if (users.length === 0) {
    throw new Error('Nenhum usuário no banco. Rode `pnpm db:seed` antes.')
  }

  const removed = await prisma.event.deleteMany({
    where: { title: { startsWith: TITLE_PREFIX } },
  })
  console.log(`🧹 Removidos ${removed.count} eventos [loadtest] anteriores`)

  let created = 0
  while (created < TOTAL) {
    const n = Math.min(BATCH, TOTAL - created)
    const data = Array.from({ length: n }).map(() => {
      const primary = faker.helpers.arrayElement(CATEGORIES)
      return {
        title: `${TITLE_PREFIX} ${faker.lorem.words(3)}`,
        description: faker.lorem.sentence(),
        date: faker.date.soon({ days: 30 }),
        latitude: faker.location.latitude({ min: -25.65, max: -25.35 }),
        longitude: faker.location.longitude({ min: -49.45, max: -49.15 }),
        categories: [primary],
        isPublic: true,
        authorId: faker.helpers.arrayElement(users).id,
      }
    })
    await prisma.event.createMany({ data })
    created += n
    console.log(`   ✓ ${created}/${TOTAL} eventos criados`)
  }

  console.log(`✅ ${TOTAL} eventos [loadtest] prontos na região de Curitiba`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
