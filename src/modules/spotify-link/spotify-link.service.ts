import type { SpotifyLink } from '@prisma/client'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import type { GenreKey } from '../../lib/genres'
import { GENRES } from '../../lib/genres'
import { logger } from '../../lib/logger'
import { spotifySyncTotal } from '../../lib/metrics'
import { prisma } from '../../lib/prisma'
import {
  getSpotifyClient,
  type SpotifyArtist,
  type SpotifyTimeRange,
} from '../../lib/spotify'
import {
  decryptRefreshToken,
  encryptRefreshToken,
} from '../../lib/spotify/crypto'
import { setDerivedConsent } from '../consent/consent.service'
import {
  addUserPreferences,
  findUserPreferredSubcategories,
} from '../users/users.repository'
import { mapSpotifyGenres } from './spotify-link.mapping'
import {
  deleteLinkAndSnapshot,
  findLinkBySpotifyUserId,
  findLinkByUserId,
  findSnapshotByUserId,
  markLinkRevoked,
  setHiddenArtists as persistHiddenArtists,
  touchLinkSynced,
  updateLinkTokens,
  upsertLink,
  upsertSnapshot,
} from './spotify-link.repository'
import {
  type ApplyGenresBody,
  type LinkSpotifyBody,
  type SnapshotArtist,
  snapshotArtistsSchema,
} from './spotify-link.schema'

const log = logger.child({ component: 'spotify-link' })

/** IP e user-agent da requisição, para a trilha de auditoria do consentimento. */
type RequestMeta = { ipAddress?: string | null; userAgent?: string | null }

/** Escopo sem o qual a feature não existe — os outros são de fases futuras. */
const REQUIRED_SCOPE = 'user-top-read'

/** Quantos artistas o snapshot guarda (a API devolve mais para o de-para). */
const SNAPSHOT_ARTIST_LIMIT = 20
const TOP_ARTISTS_FETCH_LIMIT = 50

/**
 * Teto de gêneros importados de uma vez. Não é tuning de infra, é regra de
 * produto: o ranking do feed só considera os primeiros interesses, então
 * despejar doze gêneros de uma vez empurraria para fora o que o usuário
 * escolheu à mão.
 */
const MAX_IMPORTED_GENRES = 5

/** Categorias em que um gênero musical faz sentido (todas compartilham a lista). */
const GENRE_CATEGORIES = GENRES[0].appliesTo

export async function linkSpotifyAccount(
  userId: string,
  body: LinkSpotifyBody,
  meta: RequestMeta,
) {
  const client = getSpotifyClient()
  const grant = await client.exchangeCode(
    body.code,
    body.codeVerifier,
    env.SPOTIFY_REDIRECT_URI,
  )

  // O usuário pode desmarcar escopos na tela do Spotify: sem o de top artists
  // não há o que sincronizar, então recusamos em vez de criar vínculo inútil.
  if (!grant.scopes.includes(REQUIRED_SCOPE)) {
    throw new AppError(403, 'SPOTIFY_SCOPE_MISSING')
  }

  const account = await client.getMe(grant.accessToken)

  const existing = await findLinkBySpotifyUserId(account.id)
  if (existing && existing.userId !== userId) {
    throw new AppError(409, 'SPOTIFY_ACCOUNT_IN_USE')
  }

  const now = new Date()
  const link = await upsertLink({
    userId,
    spotifyUserId: account.id,
    displayName: account.displayName,
    refreshTokenEncrypted: encryptRefreshToken(grant.refreshToken),
    scopes: grant.scopes,
    syncedAt: now,
  })

  // Primeiro sync com o access token recém-obtido: sem gastar um refresh, e o
  // app já recebe os gêneros para oferecer a importação na mesma tela.
  await syncTasteWithToken(userId, grant.accessToken, now)

  await setDerivedConsent(userId, 'spotifyData', true, meta)

  return buildProfileState(userId, link)
}

export async function unlinkSpotifyAccount(userId: string, meta: RequestMeta) {
  const link = await findLinkByUserId(userId)
  if (!link) throw new AppError(404, 'SPOTIFY_NOT_LINKED')

  // O Spotify não expõe revogação de refresh token: apagar aqui encerra o
  // tratamento do nosso lado, e a copy do app orienta a remover o Clubber em
  // spotify.com/account/apps. Os interesses já aplicados ficam — no momento do
  // apply viraram escolha do usuário, indistintos dos que ele marcou à mão.
  await deleteLinkAndSnapshot(userId)
  await setDerivedConsent(userId, 'spotifyData', false, meta)
}

export async function getSpotifyProfileState(userId: string) {
  const link = await findLinkByUserId(userId)
  return buildProfileState(userId, link)
}

/**
 * Aplica os gêneros importados aos interesses do perfil. Opt-in explícito: só
 * roda quando o usuário confirma, e nunca sobrescreve o que ele já escolheu.
 */
export async function applyImportedGenres(
  userId: string,
  body: ApplyGenresBody,
) {
  const snapshot = await findSnapshotByUserId(userId)
  if (!snapshot) throw new AppError(404, 'SPOTIFY_NOT_LINKED')

  const available = snapshot.genreKeys
  let selected = available
  if (body.genres) {
    // O cliente escolhe um subconjunto do que ELE tem — não pode inventar gosto.
    const unknown = body.genres.filter((g) => !available.includes(g))
    if (unknown.length > 0) {
      throw new AppError(422, 'VALIDATION_ERROR', 'genres')
    }
    // Preserva a ordem de afinidade do snapshot, não a ordem que o app mandou.
    selected = available.filter((g) => body.genres?.includes(g))
  }

  const applied = selected.slice(0, MAX_IMPORTED_GENRES)

  // Gênero só casa com evento de vida noturna. Sem nenhuma dessas categorias no
  // perfil, o interesse importado nunca seria usado — então a categoria mínima
  // entra junto (o app mostra isso na confirmação).
  const categories = await prisma.userCategoryPreference.findMany({
    where: { userId },
    select: { category: true },
  })
  const hasGenreCategory = categories.some((c) =>
    GENRE_CATEGORIES.includes(c.category),
  )

  if (applied.length > 0) {
    await addUserPreferences(userId, {
      subcategories: applied,
      ...(hasGenreCategory ? {} : { categories: ['MUSIC'] }),
    })
  }

  return {
    applied,
    interests: await findUserPreferredSubcategories(userId),
  }
}

export async function setHiddenArtists(
  userId: string,
  hiddenArtistIds: string[],
) {
  const link = await findLinkByUserId(userId)
  if (!link) throw new AppError(404, 'SPOTIFY_NOT_LINKED')

  const snapshot = await findSnapshotByUserId(userId)
  const known = new Set(readSnapshotArtists(snapshot?.artists).map((a) => a.id))
  // Esconder um artista que não está no snapshot não é um pedido possível:
  // recusamos em vez de guardar lixo que nunca seria filtrado.
  if (hiddenArtistIds.some((id) => !known.has(id))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'hiddenArtistIds')
  }

  const updated = await persistHiddenArtists(userId, [
    ...new Set(hiddenArtistIds),
  ])
  return buildProfileState(userId, updated)
}

export type SyncOutcome = 'ok' | 'revoked'

/**
 * Sincroniza o gosto de UM vínculo. Revogação não lança: é desfecho esperado
 * (o usuário removeu o app no Spotify, ou o JWT_SECRET rotacionou e o token
 * ficou indecifrável) e o reconciler precisa seguir o lote.
 */
export async function syncTasteForLink(
  link: SpotifyLink,
  now: Date = new Date(),
): Promise<{ outcome: SyncOutcome }> {
  let refreshToken: string
  try {
    refreshToken = decryptRefreshToken(link.refreshTokenEncrypted)
  } catch {
    log.warn({ userId: link.userId }, 'refresh token indecifrável')
    await markLinkRevoked(link.userId, 'undecryptable')
    spotifySyncTotal.inc({ outcome: 'revoked' })
    return { outcome: 'revoked' }
  }

  const result = await getSpotifyClient().refreshAccessToken(refreshToken)
  if (result.kind === 'revoked') {
    await markLinkRevoked(link.userId, 'invalid_grant')
    spotifySyncTotal.inc({ outcome: 'revoked' })
    return { outcome: 'revoked' }
  }

  // O Spotify pode rotacionar o refresh token: persistir ANTES de usar o
  // access, senão uma falha adiante deixaria o token velho gravado — e ele já
  // não vale mais.
  if (result.refreshToken) {
    await updateLinkTokens(
      link.userId,
      encryptRefreshToken(result.refreshToken),
    )
  }

  await syncTasteWithToken(link.userId, result.accessToken, now)
  return { outcome: 'ok' }
}

/** Busca o top de artistas e regrava o snapshot inteiro (dado derivado). */
async function syncTasteWithToken(
  userId: string,
  accessToken: string,
  now: Date,
) {
  const timeRange = env.SPOTIFY_TOP_TIME_RANGE as SpotifyTimeRange
  const artists = await getSpotifyClient().getTopArtists(
    accessToken,
    timeRange,
    TOP_ARTISTS_FETCH_LIMIT,
  )

  const { genreKeys, unmapped } = mapSpotifyGenres(artists)
  if (unmapped.length > 0) {
    log.info({ userId, unmapped }, 'gêneros do Spotify sem de-para')
  }

  await upsertSnapshot({
    userId,
    timeRange,
    artists: toSnapshotArtists(artists),
    genreKeys,
    unmappedGenres: unmapped,
    syncedAt: now,
  })
  await touchLinkSynced(userId, now)
  spotifySyncTotal.inc({ outcome: 'ok' })
}

function toSnapshotArtists(artists: SpotifyArtist[]): SnapshotArtist[] {
  return artists.slice(0, SNAPSHOT_ARTIST_LIMIT).map((a, rank) => ({
    id: a.id,
    name: a.name,
    imageUrl: a.imageUrl,
    genres: a.genres,
    rank,
  }))
}

/** O Json do banco é `unknown` para o TS — valida na leitura em vez de confiar. */
export function readSnapshotArtists(raw: unknown): SnapshotArtist[] {
  const parsed = snapshotArtistsSchema.safeParse(raw)
  return parsed.success ? parsed.data : []
}

export function spotifyArtistUrl(artistId: string): string {
  return `https://open.spotify.com/artist/${artistId}`
}

async function buildProfileState(userId: string, link: SpotifyLink | null) {
  if (!link) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { spotifyArtistsVisible: true },
    })
    return {
      linked: false,
      status: null,
      displayName: null,
      lastSyncedAt: null,
      artistsVisible: user?.spotifyArtistsVisible ?? true,
      genres: [] as GenreKey[],
      artists: [],
    }
  }

  const [snapshot, user] = await Promise.all([
    findSnapshotByUserId(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { spotifyArtistsVisible: true },
    }),
  ])
  const hidden = new Set(link.hiddenArtistIds)

  return {
    linked: true,
    status: link.status,
    displayName: link.displayName,
    lastSyncedAt: link.lastSyncedAt,
    artistsVisible: user?.spotifyArtistsVisible ?? true,
    genres: snapshot?.genreKeys ?? [],
    // O dono vê tudo, com a marca do que está oculto — é a tela de gestão.
    artists: readSnapshotArtists(snapshot?.artists).map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl,
      spotifyUrl: spotifyArtistUrl(a.id),
      rank: a.rank,
      hidden: hidden.has(a.id),
    })),
  }
}
