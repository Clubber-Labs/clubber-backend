import type { Prisma, SpotifyLink } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export function findLinkByUserId(userId: string) {
  return prisma.spotifyLink.findUnique({ where: { userId } })
}

export function findLinkBySpotifyUserId(spotifyUserId: string) {
  return prisma.spotifyLink.findUnique({ where: { spotifyUserId } })
}

export function findSnapshotByUserId(userId: string) {
  return prisma.spotifyTasteSnapshot.findUnique({ where: { userId } })
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
  const { userId, ...rest } = data
  return prisma.spotifyTasteSnapshot.upsert({
    where: { userId },
    create: { userId, ...rest },
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
