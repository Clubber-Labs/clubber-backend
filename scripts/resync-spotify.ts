/**
 * Força o sync de gosto de todos os vínculos ativos, agora.
 *
 * Existe para o caso em que o dado é válido mas incompleto porque o MODELO
 * mudou depois dele — quem vinculou antes das três janelas tem só a padrão, e
 * esperar o tick do reconciler deixaria o perfil com o seletor pela metade.
 *
 *   npx tsx scripts/resync-spotify.ts
 */
import { prisma } from '../src/lib/prisma'
import { syncTasteForLink } from '../src/modules/spotify-link/spotify-link.service'

async function main() {
  const links = await prisma.spotifyLink.findMany({
    where: { status: 'ACTIVE' },
  })
  console.log(`vínculos ativos: ${links.length}`)

  for (const link of links) {
    try {
      const { outcome } = await syncTasteForLink(link)
      console.log(`  ${link.userId.slice(0, 8)} → ${outcome}`)
    } catch (err) {
      console.error(`  ${link.userId.slice(0, 8)} → falhou:`, err)
    }
  }

  const rows = await prisma.spotifyTasteSnapshot.groupBy({
    by: ['timeRange'],
    _count: true,
  })
  console.log('snapshots por janela:', rows)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
