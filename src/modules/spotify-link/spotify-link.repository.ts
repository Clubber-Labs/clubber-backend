import type { Prisma, SpotifyLink } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { SpotifyTimeRange } from '../../lib/spotify'
import { DEFAULT_TIME_RANGE } from './spotify-link.schema'

export function findLinkByUserId(userId: string) {
  return prisma.spotifyLink.findUnique({ where: { userId } })
}

export function findLinkBySpotifyUserId(spotifyUserId: string) {
  return prisma.spotifyLink.findUnique({ where: { spotifyUserId } })
}

export function findSnapshotByUserId(
  userId: string,
  timeRange: SpotifyTimeRange = DEFAULT_TIME_RANGE,
) {
  return prisma.spotifyTasteSnapshot.findUnique({
    where: { userId_timeRange: { userId, timeRange } },
  })
}

export function findSnapshotsByUserId(userId: string) {
  return prisma.spotifyTasteSnapshot.findMany({ where: { userId } })
}

/**
 * Snapshot que ainda pode ser cruzado com o de outra pessoa. Revogar o vínculo
 * NÃO apaga o snapshot — o dono continua vendo o próprio gosto e podendo
 * reconectar —, mas o dado congelou no momento em que o acesso foi retirado,
 * e cruzar dado velho é pior que não cruzar. A regra fica na query para não
 * depender de cada chamador lembrar dela.
 *
 * Cruza sempre a janela padrão: comparar o "agora" de um com o "sempre" de
 * outro produziria uma interseção que não quer dizer nada.
 */
export function findActiveSnapshotByUserId(userId: string) {
  return prisma.spotifyTasteSnapshot.findFirst({
    where: {
      userId,
      timeRange: DEFAULT_TIME_RANGE,
      user: { spotifyLink: { status: 'ACTIVE' } },
    },
  })
}

/**
 * Cria ou atualiza o vínculo. Revincular (inclusive trocando de conta Spotify)
 * limpa o estado de revogação e o erro do último sync.
 */
export function upsertLink(data: {
  userId: string
  spotifyUserId: string
  displayName: string | null
  refreshTokenEncrypted: string
  scopes: string[]
  syncedAt: Date
}) {
  const { userId, ...rest } = data
  return prisma.spotifyLink.upsert({
    where: { userId },
    create: {
      userId,
      spotifyUserId: rest.spotifyUserId,
      displayName: rest.displayName,
      refreshTokenEncrypted: rest.refreshTokenEncrypted,
      scopes: rest.scopes,
      lastSyncedAt: rest.syncedAt,
    },
    update: {
      spotifyUserId: rest.spotifyUserId,
      displayName: rest.displayName,
      refreshTokenEncrypted: rest.refreshTokenEncrypted,
      scopes: rest.scopes,
      status: 'ACTIVE',
      lastSyncError: null,
      lastSyncedAt: rest.syncedAt,
    },
  })
}

export function updateLinkTokens(
  userId: string,
  refreshTokenEncrypted: string,
) {
  return prisma.spotifyLink.update({
    where: { userId },
    data: { refreshTokenEncrypted },
  })
}

export function markLinkRevoked(userId: string, reason: string) {
  return prisma.spotifyLink.update({
    where: { userId },
    data: { status: 'REVOKED', lastSyncError: reason },
  })
}

export function touchLinkSynced(userId: string, syncedAt: Date) {
  return prisma.spotifyLink.update({
    where: { userId },
    data: { lastSyncedAt: syncedAt, lastSyncError: null },
  })
}

export function setHiddenArtists(userId: string, hiddenArtistIds: string[]) {
  return prisma.spotifyLink.update({
    where: { userId },
    data: { hiddenArtistIds },
  })
}

/** Desvincular apaga tudo: tokens e o gosto derivado saem juntos. */
export function deleteLinkAndSnapshot(userId: string) {
  return prisma.$transaction([
    prisma.spotifyTasteSnapshot.deleteMany({ where: { userId } }),
    prisma.spotifyLink.deleteMany({ where: { userId } }),
  ])
}

export function upsertSnapshot(data: {
  userId: string
  timeRange: string
  artists: Prisma.InputJsonValue
  genreKeys: string[]
  unmappedGenres: string[]
  syncedAt: Date
}) {
  const { userId, timeRange, ...rest } = data
  return prisma.spotifyTasteSnapshot.upsert({
    where: { userId_timeRange: { userId, timeRange } },
    create: { userId, timeRange, ...rest },
    update: rest,
  })
}

/**
 * Vínculos ativos que nunca sincronizaram ou cujo sync venceu. `nulls: 'first'`
 * põe quem nunca sincronizou na frente da fila.
 */
export function findLinksDueForSync(
  cutoff: Date,
  take: number,
): Promise<SpotifyLink[]> {
  return prisma.spotifyLink.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    take,
  })
}
