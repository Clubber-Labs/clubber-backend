import { afterAll, describe, expect, it } from 'vitest'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import { decryptRefreshToken } from '../../lib/spotify/crypto'
import { makeSpotifyLink, makeUser } from '../../test/factories'
import { fakeSpotify } from '../../test/fake-spotify'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcileSpotifyTaste,
  startSpotifyTasteReconciler,
  stopSpotifyTasteReconciler,
} from './spotify-taste.reconciler'

const DAY_MS = 86_400_000

afterAll(async () => {
  await testPrisma.$disconnect()
})

describe('reconcileSpotifyTaste', () => {
  it('sincroniza vínculo vencido e grava o snapshot', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, {
      lastSyncedAt: new Date(Date.now() - 2 * DAY_MS),
    })

    const result = await reconcileSpotifyTaste(DAY_MS)

    expect(result).toMatchObject({ due: 1, synced: 1, revoked: 0, failed: 0 })
    const snapshot = await testPrisma.spotifyTasteSnapshot.findUnique({
      where: { userId: user.id },
    })
    expect(snapshot?.genreKeys).toEqual([
      'GENRE_HOUSE',
      'GENRE_EDM',
      'GENRE_FUNK',
      'GENRE_POP',
    ])
  })

  it('inclui quem nunca sincronizou', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, { lastSyncedAt: null })

    expect(await reconcileSpotifyTaste(DAY_MS)).toMatchObject({
      due: 1,
      synced: 1,
    })
  })

  it('ignora vínculo sincronizado há pouco', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, { lastSyncedAt: new Date() })

    expect(await reconcileSpotifyTaste(DAY_MS)).toMatchObject({ due: 0 })
  })

  it('ignora vínculo revogado', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, {
      status: 'REVOKED',
      lastSyncedAt: null,
    })

    expect(await reconcileSpotifyTaste(DAY_MS)).toMatchObject({ due: 0 })
  })

  it('marca como revogado quando o usuário tirou o app, sem quebrar o lote', async () => {
    const revogado = await makeUser()
    const ok = await makeUser()
    await makeSpotifyLink(revogado.id, {
      refreshToken: 'token-revogado',
      lastSyncedAt: null,
    })
    await makeSpotifyLink(ok.id, {
      refreshToken: 'token-bom',
      lastSyncedAt: null,
    })
    fakeSpotify.refreshOverride = (t) =>
      t === 'token-revogado'
        ? { kind: 'revoked' }
        : { kind: 'ok', accessToken: 'access', refreshToken: null }

    const result = await reconcileSpotifyTaste(DAY_MS)

    expect(result).toMatchObject({ due: 2, synced: 1, revoked: 1, failed: 0 })
    const link = await testPrisma.spotifyLink.findUnique({
      where: { userId: revogado.id },
    })
    expect(link?.status).toBe('REVOKED')
    expect(link?.lastSyncError).toBe('invalid_grant')
    // O outro seguiu normalmente.
    expect(
      await testPrisma.spotifyTasteSnapshot.findUnique({
        where: { userId: ok.id },
      }),
    ).not.toBeNull()
  })

  it('persiste o refresh token rotacionado, cifrado', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, {
      refreshToken: 'token-antigo',
      lastSyncedAt: null,
    })
    fakeSpotify.refreshOverride = () => ({
      kind: 'ok',
      accessToken: 'access',
      refreshToken: 'token-rotacionado',
    })

    await reconcileSpotifyTaste(DAY_MS)

    const link = await testPrisma.spotifyLink.findUnique({
      where: { userId: user.id },
    })
    expect(decryptRefreshToken(link?.refreshTokenEncrypted ?? '')).toBe(
      'token-rotacionado',
    )
  })

  it('trata token indecifrável como revogação (JWT_SECRET rotacionado)', async () => {
    const user = await makeUser()
    await makeSpotifyLink(user.id, { lastSyncedAt: null })
    await testPrisma.spotifyLink.update({
      where: { userId: user.id },
      data: { refreshTokenEncrypted: 'lixo.que.nao.decifra' },
    })

    const result = await reconcileSpotifyTaste(DAY_MS)

    expect(result).toMatchObject({ revoked: 1, failed: 0 })
    const link = await testPrisma.spotifyLink.findUnique({
      where: { userId: user.id },
    })
    expect(link?.status).toBe('REVOKED')
    expect(link?.lastSyncError).toBe('undecryptable')
  })

  it('aborta o lote no rate limit em vez de queimar a cota', async () => {
    for (let i = 0; i < 3; i++) {
      const user = await makeUser()
      await makeSpotifyLink(user.id, { lastSyncedAt: null })
    }
    fakeSpotify.refreshOverride = () => {
      throw new AppError(429, 'SPOTIFY_RATE_LIMITED')
    }

    const result = await reconcileSpotifyTaste(DAY_MS)

    expect(result.due).toBe(3)
    // Parou na primeira falha: não tentou os outros dois.
    expect(result.failed).toBe(1)
    expect(fakeSpotify.refreshCalls).toBe(1)
  })

  it('erro comum não derruba os demais do lote', async () => {
    const quebrado = await makeUser()
    const ok = await makeUser()
    await makeSpotifyLink(quebrado.id, {
      refreshToken: 'token-ruim',
      lastSyncedAt: null,
    })
    await makeSpotifyLink(ok.id, {
      refreshToken: 'token-bom',
      lastSyncedAt: null,
    })
    fakeSpotify.refreshOverride = (t) => {
      if (t === 'token-ruim')
        throw new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE')
      return { kind: 'ok', accessToken: 'access', refreshToken: null }
    }

    const result = await reconcileSpotifyTaste(DAY_MS)

    expect(result).toMatchObject({ due: 2, synced: 1, failed: 1 })
  })

  it('respeita o teto do lote', async () => {
    for (let i = 0; i < 3; i++) {
      const user = await makeUser()
      await makeSpotifyLink(user.id, { lastSyncedAt: null })
    }

    const result = await reconcileSpotifyTaste(DAY_MS)
    expect(result.due).toBeLessThanOrEqual(50)
    expect(result.synced).toBe(3)
  })
})

describeReconcilerTimer('spotify taste', {
  start: () =>
    startSpotifyTasteReconciler(
      env.SPOTIFY_SYNC_INTERVAL_MS,
      env.SPOTIFY_SYNC_MAX_AGE_MS,
    ),
  stop: stopSpotifyTasteReconciler,
  intervalMs: env.SPOTIFY_SYNC_INTERVAL_MS,
})
