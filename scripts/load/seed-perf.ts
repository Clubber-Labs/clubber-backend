/**
 * Seed de performance — popula um banco SEPARADO (conectai_perf) com eventos
 * distribuídos numa grade espacial cobrindo SP + RJ + BH, pra medir a busca
 * por proximidade sob carga (k6). NÃO rodar contra dev/test.
 *
 * Uso:
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/conectai_perf" \
 *     pnpm exec tsx scripts/load/seed-perf.ts --events 10000
 *
 * (RNF05.3 — 10x): rode com --events 100000 e repita o k6 pra mostrar que o
 * p95 continua ≤ 1s sem degradar.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CITIES = [
  { name: 'SP', lat: -23.55, lng: -46.63 },
  { name: 'RJ', lat: -22.91, lng: -43.2 },
  { name: 'BH', lat: -19.92, lng: -43.94 },
]
const CATEGORIES = ['Festa', 'Show', 'Esporte', 'Cultura', 'Tech']
const BATCH = 1000
const SPREAD_DEG = 0.3 // ~33 km ao redor de cada centro

function numArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1])
  return fallback
}

async function main() {
  const total = numArg('--events', 10000)
  const dbUrl = process.env.DATABASE_URL ?? ''
  // Guarda de segurança: só roda contra um banco de perf.
  if (!dbUrl.includes('perf')) {
    throw new Error(
      `Recusando: DATABASE_URL deve apontar pra um banco de perf (conter "perf"). Atual: "${dbUrl}"`,
    )
  }
  console.log(`Seed de ${total} eventos em ${dbUrl}…`)

  const author = await prisma.user.create({
    data: {
      name: 'Perf',
      lastname: 'Seed',
      username: `perf_${randomUUID().slice(0, 8)}`,
      email: `perf_${randomUUID().slice(0, 8)}@perf.local`,
      password: null,
      isPrivate: false,
    },
  })

  const now = Date.now()
  let created = 0
  while (created < total) {
    const n = Math.min(BATCH, total - created)
    const rows = Array.from({ length: n }, (_, k) => {
      const idx = created + k
      const city = CITIES[idx % CITIES.length]
      const lat = city.lat + (Math.random() - 0.5) * 2 * SPREAD_DEG
      const lng = city.lng + (Math.random() - 0.5) * 2 * SPREAD_DEG
      // maioria no futuro, alguns no passado (variedade de lifecycle)
      const offsetDays = (Math.random() - 0.2) * 30
      return {
        title: `Evento perf ${idx}`,
        description: `Descrição do evento de performance ${idx}`,
        date: new Date(now + offsetDays * 86_400_000),
        latitude: lat,
        longitude: lng,
        category: CATEGORIES[idx % CATEGORIES.length],
        isPublic: true,
        authorId: author.id,
      }
    })
    await prisma.event.createMany({ data: rows })
    created += n
    if (created % (BATCH * 10) === 0 || created === total) {
      console.log(`  ${created}/${total}`)
    }
  }

  console.log('Seed concluído.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
